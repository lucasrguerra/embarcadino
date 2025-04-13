"use strict";

const security = require('../security');
const { Markup } = require('telegraf');
const session = require('../session');
const gemini = require('../gemini');
const utils = require('../utils');
const web = require('../web');

async function postTheme(context) {
    const theme = context.message.text;
    context.reply(`Você tem alguma referência para esse tema?`);
    context.session.data.post_theme = theme;
    context.session.state = session.states.AWAITING_POST_REFERENCE;
}

async function postReference(context) {
    const reference = context.message.text;
    if (reference.toLowerCase() === "não") {
        context.reply("Ok, vamos seguir em frente.");
        context.session.data.post_reference = null;
        return;
    }

    const reference_content = await web.getPageContent(reference);
    const resume = await gemini.createResume(context.session.data);
    context.session.data.post_reference = reference_content;
    context.session.data.post_resume = resume;
    context.session.state = session.states.AWAITING_POST_EXTRA_DATA;
    context.reply(
        resume,
        Markup.inlineKeyboard([
            Markup.button.callback("Aprovado", "confirm_post"),
            Markup.button.callback("Adicionar Informação", "add_data"),
        ])
    );
}

async function extraData(context) {
    const extra_data = context.message.text;
    if (extraData.toLowerCase() === "não") {
        context.reply("Ok, vamos seguir em frente.");
        context.session.data.extra_data = null;
        return;
    }

    context.session.data.extra_data += `${extra_data}\n\n`;
    const resume = await gemini.createResume(context.session.data);
    context.reply(
        resume,
        Markup.inlineKeyboard([
            Markup.button.callback("Aprovado", "confirm_post"),
            Markup.button.callback("Adicionar Informação", "add_data"),
        ])
    );
}

async function getContent(context) {
    const url = context.message.text;
    const content = await web.getPageContent(url);
    const chunks = utils.divideIntoChunks(content, 4096);
    for (const chunk of chunks) {
        await context.reply(chunk);
    }

    context.session.state = session.states.FREE;
}


module.exports = async function onText(context) {
    if (!security.isAuthorizedUser(context)) {
        context.reply("Você não está autorizado a usar este bot no momento.");
        return;
    };

    const session_state = context.session.state;
    switch (session_state) {
        case session.states.AWAITING_POST_THEME:
            await postTheme(context);
            break;

        case session.states.AWAITING_POST_REFERENCE:
            await postReference(context);
            break;
        
        case session.states.AWAITING_POST_EXTRA_DATA:
            await extraData(context);
            break;

        case session.states.AWAITING_URL:
            await getContent(context);
            break;

        default:
            context.reply(
                "Desculpe, não entendi o que você quis dizer. Por favor, digite recomece a conversa",
                Markup.inlineKeyboard([
                    Markup.button.callback("Recomeçar", "start"),
                ])
            );
            break;
    }

    return;
}