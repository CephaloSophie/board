// Kept for compatibility: the PM2 configuration lives at the repository root
// (ecosystem.config.cjs: API + front). This file only starts the front.
module.exports = { apps: require('../ecosystem.config.cjs').apps.filter((app) => app.name === 'kydos-client') };
