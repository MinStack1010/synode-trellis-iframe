export default {
    ssr: false,
    // target: "server" khi dev (để serverMiddleware proxy hoạt động),
    //         "static" khi production (nuxt generate → nginx serve)
    target: process.env.NODE_ENV === "production" ? "static" : "server",
    env: {
        // Proxy path được nginx forward đến http://34.42.10.21:8080
        // Khi dev local: serverMiddleware forward đến TRELLIS_PROXY_TARGET
        trellisApiUrl: "/trellis-api"
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
