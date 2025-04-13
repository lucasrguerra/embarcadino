"use strict";

const security = require('../security');
const { Markup } = require('telegraf');
const session = require('../session');

module.exports = function start(context) {
    let start_message = `
    Olá, eu sou o Embarcadino, o assistente virtual do Ciência Embarcada!\n
    Estou aqui para ajudar a escrever matérias para o blog e responder perguntas sobre ciência e tecnologia.\n
    Você pode me perguntar sobre qualquer assunto relacionado a ciência e tecnologia, e eu farei o meu melhor para te ajudar.
    `

    if (!security.isAuthorizedUser(context)) {
        start_message += `\n\nVocê não está autorizado a usar este bot no momento.`;
        context.reply(start_message);
        return;
    };

    context.reply(
        start_message,
        Markup.inlineKeyboard([
            Markup.button.callback("Novo Post", "new_post"),
            Markup.button.callback("Obter Conteúdo", "get_content"),
        ])
    );
    context.session = new session.Session();
    return;
}