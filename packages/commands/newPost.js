"use strict";

const security = require('../security');
const session = require('../session');

module.exports = function newPost(context) {
    if (!security.isAuthorizedUser(context)) {
        context.reply("Você não está autorizado a usar este bot no momento.");
        return;
    };

    context.reply("Qual é o tema do novo post?");
    context.session = new session.Session();
    context.session.state = session.states.AWAITING_POST_THEME;
    return;
}