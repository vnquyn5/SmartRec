const { defineConfig } =  require("cypress");

module.exports = defineConfig({
    e2e: {
        baseUrl: "http://localhost:5173",
        specPattern: "cypress/e2e/**/*.cy.{js,jsx,ts,tsx}",
        supportFile: "cypress/support/e2e.js",
        viewportWidth: 1440,
        viewportHeight: 900,
        video: false,
        setupNodeEvents(on, config) {
            return config;
        },
    },
});