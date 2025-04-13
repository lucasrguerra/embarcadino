"use strict";

const USERS_IDS = String(process.env.USERS_IDS).split(',');

function isAuthorizedUser(context) {
	let user_id = context.update.message?.from?.id;
	if (!user_id) {
		user_id = context.update.callback_query?.from?.id;
	}
	if (!user_id) {
		return false;
	}

	if (USERS_IDS.includes(String(user_id))) {
		return true;
	}
}

module.exports = {
	isAuthorizedUser,
};