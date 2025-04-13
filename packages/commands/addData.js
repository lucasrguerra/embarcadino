"use strict";

const security = require('../security');
const session = require('../session');

module.exports = async function getContent(context) {
    if (!security.isAuthorizedUser(context)) {
        context.reply("Você não está autorizado a usar este bot no momento.");
        return;
    };

    context.reply("Envie as informações que você deseja adicionar sobre o post.");
    context.session.state = session.states.AWAITING_POST_EXTRA_DATA;
    return;
}