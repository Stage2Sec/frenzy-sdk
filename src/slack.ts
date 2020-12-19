import { WebClient, ChatPostMessageArguments, WebAPICallOptions, TokenOverridable, WebAPICallResult } from "@slack/web-api"
import { SlackMessageAdapter } from "@slack/interactive-messages/dist/adapter"
import { SlackEventAdapter } from "@slack/events-api/dist/adapter"
import commander from "commander"
import stringArgv from 'string-argv';
import { 
    View, Option, InputBlock, Button, DividerBlock, SectionBlock, Overflow,
    Datepicker, Select, MultiSelect, Action, ImageElement, RadioButtons, Checkboxes,
    ActionsBlock, PlainTextElement, MrkdwnElement, HeaderBlock, StaticSelect, PlainTextInput,
    ExternalSelect, MultiExternalSelect, MultiStaticSelect, ChatUpdateArguments 
} from "@slack/web-api/dist/methods"
import { EventEmitter } from "events"
import axios from "axios"

import { asEventEmitter } from "./util";

export type ActionBlockElement = (Button | Overflow | Datepicker | Select | RadioButtons | Checkboxes | Action)
export interface SlackModal extends Omit<View, "type" | "submit" | "close" | "title"> {
    submit?: string
    close?: string
    title?: string
}
export interface ModalOpenArguments extends WebAPICallOptions, TokenOverridable {
    trigger_id: string;
    modal: SlackModal;
}
interface ModalPushArguments {
    modal: SlackModal;
}
export interface ApiModalPushArguments extends WebAPICallOptions, TokenOverridable, ModalPushArguments {
    pushMethod: "api"
    trigger_id: string;
}
export interface ResponseActionModalPushArguments extends ModalPushArguments {
    pushMethod: "responseAction"
}
export class Slack {
    constructor(webClient: WebClient, events: SlackEventAdapter, interactions: SlackMessageAdapter){
        this.client = webClient
        this.interactions = interactions
        this.events = asEventEmitter(events)
        this.on("message", this.handleMessage.bind(this))

        this.modals = new SlackModalManager(webClient)

        this.appId = process.env.SLACK_APP_ID || ""
        
        this.client.auth.test()
        .then((data: any) => {
            this.bot = {
                id: data.bot_id,
                user: data.user,
                userId: data.user_id
            }
        })
        .catch(error => console.error("Error calling client.auth.test()", error))
    }

    private events?: EventEmitter
    private optionsById: Record<string, Array<Option>> = {}
    private registeredDotCommands: EventEmitter = new EventEmitter()

    public appId: string
    public bot = {
        id: "",
        user: "",
        userId: ""
    }
    public client: WebClient
    public interactions: SlackMessageAdapter
    
    public modals: SlackModalManager

    private on(event: string, listener: (...args: any[]) => void) {
        this.events?.on(event, listener)
    }
    private handleMessage(event: any) {
        if (this.isFromBot(event)) {
            return
        }

        if (event.text) {
            event.text = event.text.trim()
            this.registeredDotCommands.eventNames().forEach(name => {
                if (event.text.startsWith(name)) {
                    this.registeredDotCommands.emit(name, event)
                }
            })
        }
    }
    private isFromBot(event: any): boolean {
        let botId = event.bot_id || event.message?.bot_id
        let userId = event.user_id || event.user || event.message?.user
        return botId == this.bot.id || userId == this.bot.userId
    }

    public dotCommand(options: string | { command: string, parser?: commander.Command}, action: (event: any) => void) {
        if (typeof options == "string") {
            options = { command: options }
        }

        let command = options.command
        let parser = options.parser
        if (!command.startsWith(".")) {
            command = `.${command}`
        }

        this.registeredDotCommands.on(command, (event) => {
            if (parser) {
                parser.parse(stringArgv(event.text, undefined, command), { from: "user" })
                event.args = parser
            }
            action(event)
        })
    }

    public postError(options: {
        channel: string,
        threadTs?: string,
        error: any
    }) {
        return this.postMessage({
            channel: options.channel,
            text: options.error.toString(),
            thread_ts: options.threadTs,
            icon_emoji: ":x:"
        })
        .catch(error => console.error("Error posting error\n", error))
    }
    public postMessage(options: ChatPostMessageArguments) {
        return this.client.chat.postMessage(options)
        .then(result => {
            if (result.error) {
                throw result.error
            }
            return result
        })
    }
    public updateMessage(options: ChatUpdateArguments) {
        return this.client.chat.update(options)
        .then(result => {
            if (result.error) {
                throw result.error
            }
            return result
        })
    }

    public async getFile(url: string) {
        let response = await axios.get(url, {
            headers: {
                "Authorization": `Bearer ${this.client.token}`
            }
        })
        return response.data
    }

    public storeOptions(id: string, options: Array<Option>) {
        this.optionsById[id] = options
    }
    public getOptions(id: string) {
        return this.optionsById[id]
    }

    private getViewInput(options: {
        view: View,
        blockId: string,
        actionId: string
    }) {
        let block = (options.view as any).state?.values[options.blockId]
        if (!block) {
            return
        }
        return block[options.actionId]
    }

    public getSelectedOption(options: {
        view: View,
        blockId: string,
        actionId?: string
    }) {
        if (!options.actionId) {
            options.actionId = "selection"
        }

        let input = this.getViewInput({
            view: options.view,
            blockId: options.blockId,
            actionId: options.actionId
        })

        return input?.selected_option.value
    }
    public getSelectedOptions(options: {
        view: View,
        blockId: string,
        actionId?: string
    }): Array<string> {
        if (!options.actionId) {
            options.actionId = "selection"
        }

        let input = this.getViewInput({
            view: options.view,
            blockId: options.blockId,
            actionId: options.actionId
        })

        return input?.selected_options?.map(o => o.value) || []
    }
    public getPlainTextValue(options: {
        view: View,
        blockId: string,
        actionId: string
    }) {
        let input = this.getViewInput(options)
        return input?.value
    }
}

export class SlackModalManager {
    constructor(client: WebClient){
        this.client = client
    }

    private client: WebClient

    private toView(modal: SlackModal): View {
        return {
            ...modal,
            type: "modal",
            title: modal.title ? blockFactory.plainText(modal.title) : undefined,
            submit: modal.submit ? blockFactory.plainText(modal.submit) : undefined,
            close: modal.close ? blockFactory.plainText(modal.close) : undefined
        }
    }

    private async updateMetadata(view: View, action: (metadata: any) => void | Promise<void>) {
        let metadata = this.getMetadata(view)
        let result = action(metadata)
        if (result instanceof Promise) {
            await result
        }
        view.private_metadata = JSON.stringify(metadata)
    }
    public getMetadata(view: View) {
        return view.private_metadata ? JSON.parse(view.private_metadata) : {}
    }

    /**
     * Opens a new modal in slack
     */
    public async open(options: ModalOpenArguments) {
        try {
            return await this.client.views.open({
                ...options,
                view: this.toView(options.modal)
            })
        } catch (error) {
            console.error("Error opening modal\n", error)
        }
        return undefined
    }

    /**
     * Pushes a modal onto the slack modal stack via the `response_action` method
     */
    public push(options: ResponseActionModalPushArguments): any

    /**
     * Pushes a modal onto the slack modal stack via the `api` method
     */
    public push(options: ApiModalPushArguments): Promise<WebAPICallResult>
    public async push(options: any) {
        if (isResponseAction(options)) {
            return {
                response_action: "push",
                view: this.toView(options.modal)
            }
        }

        if (isApi(options)) {
            try {
                return await this.client.views.push({
                    ...options,
                    view: this.toView(options.modal)
                })
            } catch (error) {
                console.error("Error pushing modal\n", error)
            }
        }
        return undefined

        function isResponseAction(obj: any): obj is ResponseActionModalPushArguments {
            return (obj as ResponseActionModalPushArguments).pushMethod == "responseAction"
        }
        function isApi(obj: any): obj is ApiModalPushArguments {
            return (obj as ApiModalPushArguments).pushMethod == "api"
        }
    }

    /**
     * Updates an existing modal in slack
     * @param view The modal to update
     * @param action The action to change the view and its metadata
     */
    public async update(view: View & { id: string }, action: (view: View, metadata: any) => void | Promise<void>) {
        try {
            await this.updateMetadata(view, metadata => action(view, metadata))
            return await this.client.views.update({
                view_id: view.id,
                view: {
                    type: view.type,
                    blocks: view.blocks,
                    callback_id: view.callback_id,
                    close: view.close,
                    submit: view.submit,
                    title: view.title,
                    clear_on_close: view.clear_on_close,
                    notify_on_close: view.notify_on_close,
                    private_metadata: view.private_metadata
                }
            })
        } catch (error) {
            console.error("Error updating modal\n", error)
        }
        return undefined
    }
}

export class SlackBlockFactory {
    public section(options: {
        text?: string,
        blockId?: string,
        fields?: (PlainTextElement | MrkdwnElement)[],
        accessory?: Button | Overflow | Datepicker | Select | MultiSelect | Action | ImageElement | RadioButtons | Checkboxes,
        markdown?: boolean
    }): SectionBlock {
        let text: any
        if (options.text) {
            text = options.markdown ? this.markdown(options.text) : this.plainText(options.text)
        }
        return {
            type: "section",
            block_id: options.blockId,
            accessory: options.accessory,
            fields: options.fields,
            text: text
        }
    }
    public plainText(text: string): PlainTextElement{
        return {
            type: "plain_text",
            text: text,
            emoji: true
        }
    }
    public markdown(text: string): MrkdwnElement {
        return {
            type: "mrkdwn",
            text: text
        }
    }
    public option(label: string, value: any): Option {
        return {
            text: this.plainText(label),
            value: `${value}`
        }
    }
    public input(options: {
        blockId: string,
        label: string,
        optional?: boolean,
        element: Select | MultiSelect | Datepicker | PlainTextInput | RadioButtons | Checkboxes
    }): InputBlock {
        return {
            type: "input",
            block_id: options.blockId,
            element: options.element,
            label: this.plainText(options.label),
            optional: options.optional
        }
    }
    public externalSelect(options: {
        placeholder?: string,
        actionId?: string,
        multi?: boolean,
        minLength?: number
    }): ExternalSelect | MultiExternalSelect {
        if (!options.actionId) {
            options.actionId = "selection"
        }
        
        let placeholder
        if (options.placeholder) {
            placeholder = this.plainText(options.placeholder)
        }
        if (options.multi) {
            return {
                type: "multi_external_select",
                action_id: options.actionId,
                min_query_length: options.minLength,
                placeholder: placeholder
            }
        }

        return {
            type: "external_select",
            action_id: options.actionId,
            placeholder: placeholder,
            min_query_length: options.minLength
        }
    }
    public staticSelect(options: {
        actionId?: string,
        placeholder?: string,
        options: Array<Option>,
        initialOption?: Option,
        multi?: boolean
    }): StaticSelect | MultiStaticSelect {
        if (!options.actionId) {
            options.actionId = "selection"
        }
        if (options.multi) {
            return {
                type: "multi_static_select",
                action_id: options.actionId,
                options: options.options,
                initial_options: options.initialOption ? [options.initialOption] : undefined,
                placeholder: options.placeholder ? this.plainText(options.placeholder) : undefined
            }
        }

        return {
            type: "static_select",
            action_id: options.actionId,
            options: options.options,
            initial_option: options.initialOption,
            placeholder: options.placeholder ? this.plainText(options.placeholder) : undefined
        }
    }
    public button(options: {
        text: string,
        actionId?: string,
        value?: string,
        style?: "danger" | "primary",
        url?: string
    }): Button {
        return {
            type: "button",
            action_id: options.actionId,
            style: options.style,
            text: this.plainText(options.text),
            value: options.value,
            url: options.url
        }
    }
    public radioButtons(options: {
        blockId: string,
        label: string,
        options: Array<Option>,
        actionId?: string
    }): InputBlock {
        if (!options.actionId) {
            options.actionId = "radioButtons"
        }

        return {
            type: "input",
            block_id: options.blockId,
            label: this.plainText(options.label),
            element: {
                type: "radio_buttons",
                action_id: options.actionId,
                options: options.options
            }
        }
    }
    public divider(): DividerBlock {
        return {
            type: "divider"
        }
    }
    public header(options: {
        text: string,
        blockId?: string
    }): HeaderBlock {
        return {
            type: "header",
            block_id: options.blockId,
            text: this.plainText(options.text)
        }
    }
    public actions(options: {
        blockId: string,
        elements: (Button | Overflow | Datepicker | Select | RadioButtons | Checkboxes | Action)[];
    }): ActionsBlock {
        return {
            type: "actions",
            block_id: options.blockId,
            elements: options.elements
        }
    }
    public plainTextInput(options: {
        actionId: string,
        multiline?: boolean
    }): PlainTextInput {
        return {
            type: "plain_text_input",
            action_id: options.actionId,
            multiline: options.multiline
        }
    }
}
export const blockFactory = new SlackBlockFactory()