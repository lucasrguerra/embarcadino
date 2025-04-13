"use strict";

const axios = require('axios');
const cheerio = require('cheerio');

async function getPageContent(url) {
    return await axios.get(url)
        .then(response => {
            const html = response.data;
            const $ = cheerio.load(html);

            $('script, style, noscript, iframe, link, meta, header, footer, nav, aside').remove();
            $('*[class*="comment"], *[id*="comment"]').remove();
            $('*[class*="social"], *[id*="social"]').remove();

            const title = $('title').text().trim();
            const content = $('body').text().replace(/\s+/g, ' ').trim();

            return `Título: ${title}\n\nConteúdo:\n${content}`;
        })
        .catch(error => {
            console.error('Error fetching the page:', error);
            return null;
        });
}

module.exports = {
    getPageContent,
};
