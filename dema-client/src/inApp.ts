// Links opened from a camera app, a messenger or a social app often open inside that app's own small browser, which usually cannot reach the
// photo gallery or save files. Spot that, so the page can say how to open the link in the real browser instead.
const IN_APP = /(FBAN|FBAV|FB_IAB|Instagram|Snapchat|MicroMessenger|WeChat|Line\/|KAKAOTALK|TikTok|Twitter|LinkedInApp|GSA\/|Pinterest|; wv\)|\bwv\b)/i;
export const inAppBrowser = () => typeof navigator !== "undefined" && IN_APP.test(navigator.userAgent);
