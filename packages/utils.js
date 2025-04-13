"use strict";

function divideIntoChunks(text, chunk_size) {
    const blocks = text.split('\n\n');
    const chunks = [];
    let current_chunk = '';

    for (const block of blocks) {
        if ((current_chunk + block).length <= chunk_size) {
            current_chunk += (current_chunk ? '\n\n' : '') + block;
        } else {
            if (current_chunk) chunks.push(current_chunk);
            current_chunk = block;
        }
    }

    if (current_chunk) chunks.push(current_chunk);
    return chunks;
}

module.exports = {
    divideIntoChunks,
};