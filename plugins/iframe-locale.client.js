const SUPPORTED_LOCALES = ["en", "fr"];

export default ({ app, route }) =>
{
	const setLocale = (locale) =>
	{
		if (SUPPORTED_LOCALES.includes(locale)) app.i18n.setLocale(locale);
	};

	setLocale(route.query.locale || route.query.lang);

	window.addEventListener("message", ({ data }) =>
	{
		if (!data || data.type !== "synode:locale") return;
		setLocale(data.locale);
	});

	if (window.parent !== window)
	{
		window.parent.postMessage({ type: "synode:iframe-ready", locale: app.i18n.locale }, "*");
	}
};
