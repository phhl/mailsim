const fs = require("fs");
const path = require("path");

function loadJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const clean = raw.replace(/^\uFEFF/, "");
  return JSON.parse(clean);
}

function resolveKey(obj, key) {
  if (!obj || !key) return undefined;
  return key.split(".").reduce((acc, part) => (acc ? acc[part] : undefined), obj);
}

function formatString(template, vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return match;
    return String(vars[name]);
  });
}

function createTranslator({ defaultLocale, localesDir }) {
  const cache = new Map();

  function loadLocale(locale) {
    if (cache.has(locale)) return cache.get(locale);
    const filePath = path.join(localesDir, `${locale}.json`);
    if (!fs.existsSync(filePath)) {
      cache.set(locale, null);
      return null;
    }
    const data = loadJson(filePath);
    cache.set(locale, data);
    return data;
  }

  return function translate(locale, key, vars) {
    const dict = loadLocale(locale) || loadLocale(defaultLocale) || {};
    const value = resolveKey(dict, key);
    if (typeof value !== "string") return key;
    return formatString(value, vars);
  };
}

module.exports = { createTranslator };
