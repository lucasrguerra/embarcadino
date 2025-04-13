"use strict";
require('dotenv').config();

const { Telegraf, session } = require('telegraf');
const { message } = require('telegraf/filters');
const commands = require('./packages/commands');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.use(session());
bot.start(commands.start);
bot.action("start", commands.start);
bot.help(commands.start);

bot.action("new_post", commands.newPost);
bot.command("new_post", commands.newPost);
bot.action("get_content", commands.getContent);
bot.command("get_content", commands.getContent);
bot.on(message("text"), commands.onText);

bot.action("confirm_post", commands.confirmPost);
bot.action("add_data", commands.addData);

bot.launch()

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))