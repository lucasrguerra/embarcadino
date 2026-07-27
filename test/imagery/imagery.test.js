import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ImageryClient, decodeDataUrl, findImageUrl } from '../../src/modules/imagery/imagery.client.js';
import {
  ImageryService,
  altOf,
  fileNameFor,
  needsImage,
} from '../../src/modules/imagery/imagery.service.js';
import { buildImagePrompt } from '../../src/modules/imagery/imagery.prompt.js';

/** PNG de 1x1 pixel, o menor payload válido para os testes de decodificação. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

const CONTENT = `<!-- wp:image {"align":"center"} -->
<figure class="wp-block-image aligncenter"><img src="" alt="Placa ESP32-C6 sobre bancada"/><figcaption>Fonte: O Autor</figcaption></figure>
<!-- /wp:image -->

<!-- wp:paragraph -->
<p>Texto.</p>
<!-- /wp:paragraph -->`;

/**
 * @param {Object} [overrides]
 * @returns {ImageryService}
 */
function serviceWith({ generate, uploadImage, canWrite = true } = {}) {
  const client = { generate: generate ?? (async () => ({ data: Buffer.from('x'), mimeType: 'image/png' })) };
  const blog = {
    canWrite,
    uploadImage: uploadImage ?? (async () => ({ id: 42, url: 'https://blog/wp-content/a.png' })),
  };

  return new ImageryService(client, blog);
}

test('decodeDataUrl aceita PNG base64 e devolve os bytes', () => {
  const { data, mimeType } = decodeDataUrl(PNG_DATA_URL);

  assert.equal(mimeType, 'image/png');
  assert.ok(data.length > 0);
  assert.equal(data.subarray(1, 4).toString(), 'PNG');
});

test('decodeDataUrl recusa formato não suportado e payload vazio', () => {
  assert.throws(() => decodeDataUrl('data:image/gif;base64,AAAA'), /não suportado/);
  assert.throws(() => decodeDataUrl('https://exemplo.com/a.png'), /data URL/);
});

test('findImageUrl lê tanto message.images quanto partes do content', () => {
  assert.equal(findImageUrl({ images: [{ image_url: { url: PNG_DATA_URL } }] }), PNG_DATA_URL);
  assert.equal(findImageUrl({ content: [{ type: 'image_url', image_url: { url: PNG_DATA_URL } }] }), PNG_DATA_URL);
  assert.equal(findImageUrl({ content: 'só texto' }), null);
});

test('ImageryClient pede a modalidade de imagem e o modelo configurado', async () => {
  const calls = [];
  const aiClient = {
    async chat(messages, options) {
      calls.push({ messages, options });
      return { message: { images: [{ image_url: { url: PNG_DATA_URL } }] } };
    },
  };

  const image = await new ImageryClient(aiClient, { model: 'google/gemini-3.1-flash-image' }).generate('desenhe');

  assert.equal(calls[0].options.model, 'google/gemini-3.1-flash-image');
  assert.deepEqual(calls[0].options.modalities, ['image', 'text']);
  assert.equal(image.mimeType, 'image/png');
});

test('ImageryClient falha quando o modelo responde só com texto', async () => {
  const aiClient = { async chat() { return { message: { content: 'Eu desenharia uma placa.' } }; } };

  await assert.rejects(
    new ImageryClient(aiClient, { model: 'x' }).generate('desenhe'),
    /sem imagem/
  );
});

test('needsImage só aceita bloco com src vazio', () => {
  assert.ok(needsImage('<img src="" alt="x"/>'));
  assert.ok(!needsImage('<img src="https://ja.tem/a.png" alt="x"/>'));
  assert.ok(!needsImage('<p>sem imagem</p>'));
});

test('altOf extrai o briefing da arte', () => {
  assert.equal(altOf('<img src="" alt="Placa ESP32-C6"/>'), 'Placa ESP32-C6');
  assert.equal(altOf('<img src=""/>'), '');
});

test('illustrate preenche o src, o id do anexo e preserva o alinhamento do bloco', async () => {
  const result = await serviceWith().illustrate({ title: 'ESP32-C6', content: CONTENT });

  assert.equal(result.failed, 0);
  assert.deepEqual(result.images, [
    { id: 42, url: 'https://blog/wp-content/a.png', alt: 'Placa ESP32-C6 sobre bancada' },
  ]);
  assert.match(result.content, /src="https:\/\/blog\/wp-content\/a\.png"/);
  assert.match(result.content, /class="wp-image-42"/);
  assert.match(result.content, /"align":"center"/);
  assert.match(result.content, /"id":42/);
  assert.match(result.content, /alt="Placa ESP32-C6 sobre bancada"/);
  assert.ok(result.content.includes('<!-- /wp:image -->'));
});

test('illustrate usa o alt como pedido ao gerador, com direção de arte', async () => {
  let prompt = '';
  await serviceWith({
    async generate(text) {
      prompt = text;
      return { data: Buffer.from('x'), mimeType: 'image/png' };
    },
  }).illustrate({ title: 'ESP32-C6', content: CONTENT });

  assert.match(prompt, /Placa ESP32-C6 sobre bancada/);
  assert.match(prompt, /Ciência Embarcada/);
  assert.match(prompt, /Não escreva nenhum texto/);
});

test('illustrate mantém o rascunho intacto quando a geração falha', async () => {
  const result = await serviceWith({
    async generate() {
      throw new Error('429 rate limit');
    },
  }).illustrate({ title: 'ESP32-C6', content: CONTENT });

  assert.equal(result.failed, 1);
  assert.deepEqual(result.images, []);
  assert.equal(result.content, CONTENT);
});

test('illustrate não gera nada sem credencial de mídia', async () => {
  let called = false;
  const result = await serviceWith({
    canWrite: false,
    async generate() {
      called = true;
      return { data: Buffer.from('x'), mimeType: 'image/png' };
    },
  }).illustrate({ title: 'ESP32-C6', content: CONTENT });

  assert.equal(called, false);
  assert.equal(result.content, CONTENT);
});

test('illustrate ignora bloco que já tem imagem', async () => {
  const withImage = CONTENT.replace('src=""', 'src="https://fonte.com/foto.jpg"');
  const result = await serviceWith().illustrate({ title: 'ESP32-C6', content: withImage });

  assert.deepEqual(result.images, []);
  assert.equal(result.content, withImage);
});

test('illustrate respeita o teto de 4 imagens por post', async () => {
  const many = Array.from({ length: 6 }, (_, i) =>
    `<!-- wp:image -->\n<figure><img src="" alt="Cena ${i}"/></figure>\n<!-- /wp:image -->`
  ).join('\n\n');

  const result = await serviceWith().illustrate({ title: 'ESP32-C6', content: many });

  assert.equal(result.images.length, 4);
});

test('fileNameFor deriva slug sem acento e com a extensão do tipo', () => {
  assert.equal(fileNameFor('Comunicação em redes LoRa', 0, 'image/png'), 'comunicacao-em-redes-lora-1.png');
  assert.equal(fileNameFor('x', 1, 'image/jpeg'), 'x-2.jpg');
  assert.equal(fileNameFor('', 0, 'image/webp'), 'imagem-1.webp');
});

test('buildImagePrompt distingue a imagem de abertura das de apoio', () => {
  const opening = buildImagePrompt({ alt: 'a', title: 't', position: 0 });
  const support = buildImagePrompt({ alt: 'a', title: 't', position: 1 });

  assert.match(opening, /abertura/);
  assert.match(support, /apoio/);
});
