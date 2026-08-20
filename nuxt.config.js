export default {
    ssr: false,
    target: "static",
    env: {
        trellisApiUrl: process.env.TRELLIS_API_URL || "/trellis-api"
    },
    head: {
        title: "Image to 3D | Synode",
        meta: [
            { charset: "utf-8" },
            { name: "viewport", content: "width=device-width, initial-scale=1" }
        ]
    },
    css: ["~/assets/scss/main.scss"],
    serverMiddleware: [
        { path: "/trellis-api", handler: "~/server-middleware/trellis-proxy.js" }
    ],
    buildModules: ["@nuxtjs/vuetify"],
    modules: ["@nuxtjs/i18n"],
    plugins: ["~/plugins/iframe-locale.client.js"],
    i18n: {
        lazy: true,
        langDir: "locales/",
        strategy: "no_prefix",
        defaultLocale: "en",
        locales: [
            { code: "en", name: "English", file: "en.js" },
            { code: "fr", name: "Français", file: "fr.js" }
        ],
        vueI18n: { fallbackLocale: "en" }
    },
    vuetify: {
        treeShake: {
            components: ["VApp", "VBtn", "VBtnToggle", "VCheckbox", "VContainer", "VDivider", "VIcon", "VRow", "VCol", "VSelect", "VSpacer", "VTextField"],
            directives: ["Ripple"]
        },
        theme: {
            themes: { light: { primary: "#17191f" } }
        }
    }
};
