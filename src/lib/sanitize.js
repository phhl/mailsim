const sanitizeHtml = require('sanitize-html');

function sanitizeBody(html) {
  const clean = sanitizeHtml(html || '', {
    allowedTags: [
      'p','br','b','strong','i','em','u',
      'ul','ol','li','blockquote',
      'a','span'
    ],
    allowedAttributes: {
      a: ['href','target','rel'],
      span: []
    },
    allowedSchemes: ['http','https','mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' })
    }
  });
  return clean;
}

function htmlToText(html) {
  // very small conversion; good enough for preview/snippet
  return (html || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/?p[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { sanitizeBody, htmlToText };
