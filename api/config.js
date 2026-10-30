'use strict';

const { json } = require('./_lib');

module.exports = (req, res) => {
  json(res, 200, { groqConfigured: !!process.env.GROQ_API_KEY });
};
