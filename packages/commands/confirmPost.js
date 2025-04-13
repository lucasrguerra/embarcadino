"use strict";

const security = require('../security');
const session = require('../session');
const gemini = require('../gemini');
const utils = require('../utils');

module.exports = async function getContent(context) {
    if (!security.isAuthorizedUser(context)) {
        context.reply("Você não está autorizado a usar este bot no momento.");
        return;
    };
    const post_content = await gemini.createPost(context.session.data);
    
    const chunks = utils.divideIntoChunks(post_content, 4096);
    for (const chunk of chunks) {
        await context.reply(chunk);
    }

    context.session = new session.Session();
    return;
}