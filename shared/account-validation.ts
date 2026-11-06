// HTML pattern uses the Unicode v flag: literal hyphens must be escaped.
// The API uses the same source so browser validation cannot drift from it.
export const loginPattern = '[a-zA-Z0-9_.\\-]{3,40}';
export const loginExpression = new RegExp(`^(?:${loginPattern})$`, 'u');
