"use strict";

const states = {
    FREE: 'free',
    AWAITING_POST_THEME: 'awaiting_post_theme',
    AWAITING_POST_REFERENCE: 'awaiting_post_reference',
    AWAITING_POST_EXTRA_DATA: 'awaiting_post_extra_data',
    AWAITING_URL: 'awaiting_url',
};

class data {
    constructor() {
        this.post_theme = null;
        this.post_reference = null;
        this.post_resume = null;
        this.extra_data = "";
    }
}

class Session {
    constructor() {
        this.state = states.FREE;
        this.data = new data();
    }
}

module.exports = {
    states,
    data,
    Session,
}