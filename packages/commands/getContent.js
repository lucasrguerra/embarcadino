"use strict";

const security = require('../security');
const session = require('../session');

module.exports = function getContent(context) {
    if (!security.isAuthorizedUser(context)) {
        context.reply("Você não está autorizado a usar este bot no momento.");
        return;
    };

    context.reply("Qual é o link do conteúdo que você gostaria de obter?");
    context.session = new session.Session();
    context.session.state = session.states.AWAITING_URL;
    return;
}