'use strict';
/**
 * YouTube 视频支持的翻译目标语言（用于 tlang 参数）
 * 覆盖 YouTube 字幕翻译支持的主要语言。
 */
module.exports = [
  ['zh-Hans', '中文（简体）'], ['zh-Hant', '中文（繁體）'], ['en', 'English'], ['ja', '日本語'],
  ['ko', '한국어'], ['es', 'Español'], ['es-419', 'Español (Latinoamérica)'], ['pt', 'Português'],
  ['pt-BR', 'Português (Brasil)'], ['fr', 'Français'], ['de', 'Deutsch'], ['it', 'Italiano'],
  ['ru', 'Русский'], ['ar', 'العربية'], ['hi', 'हिन्दी'], ['bn', 'বাংলা'], ['th', 'ไทย'],
  ['vi', 'Tiếng Việt'], ['id', 'Bahasa Indonesia'], ['ms', 'Bahasa Melayu'], ['tr', 'Türkçe'],
  ['nl', 'Nederlands'], ['pl', 'Polski'], ['sv', 'Svenska'], ['no', 'Norsk'], ['da', 'Dansk'],
  ['fi', 'Suomi'], ['cs', 'Čeština'], ['sk', 'Slovenčina'], ['hu', 'Magyar'], ['ro', 'Română'],
  ['bg', 'Български'], ['el', 'Ελληνικά'], ['he', 'עברית'], ['fa', 'فارسی'], ['ur', 'اردو'],
  ['ta', 'தமிழ்'], ['te', 'తెలుగు'], ['mr', 'मराठी'], ['gu', 'ગુજરાતી'], ['kn', 'ಕನ್ನಡ'],
  ['ml', 'മലയാളം'], ['pa', 'ਪੰਜਾਬੀ'], ['si', 'සිංහල'], ['ne', 'नेपाली'], ['si-LK', 'සිංහල (Sri Lanka)'],
  ['uk', 'Українська'], ['be', 'Беларуская'], ['sr', 'Српски'], ['hr', 'Hrvatski'], ['sl', 'Slovenščina'],
  ['bs', 'Bosanski'], ['mk', 'Македонски'], ['sq', 'Shqip'], ['lt', 'Lietuvių'], ['lv', 'Latviešu'],
  ['et', 'Eesti'], ['is', 'Íslenska'], ['ga', 'Gaeilge'], ['cy', 'Cymraeg'], ['mt', 'Malti'],
  ['ca', 'Català'], ['eu', 'Euskara'], ['gl', 'Galego'], ['af', 'Afrikaans'], ['sw', 'Kiswahili'],
  ['am', 'አማርኛ'], ['ha', 'Hausa'], ['ig', 'Igbo'], ['yo', 'Yorùbá'], ['zu', 'isiZulu'],
  ['xh', 'isiXhosa'], ['st', 'Sesotho'], ['sn', 'chiShona'], ['ny', 'Chichewa'], ['rw', 'Kinyarwanda'],
  ['so', 'Soomaali'], ['mg', 'Malagasy'], ['ka', 'ქართული'], ['hy', 'Հայերեն'], ['az', 'Azərbaycan'],
  ['kk', 'Қазақ'], ['ky', 'Кыргызча'], ['uz', 'Oʻzbek'], ['tg', 'Тоҷикӣ'], ['tk', 'Türkmen'],
  ['mn', 'Монгол'], ['tt', 'Татар'], ['ug', 'ئۇيغۇرچە'], ['ps', 'پښتو'], ['ku', 'Kurdî'],
  ['km', 'ខ្មែរ'], ['lo', 'ລາວ'], ['my', 'ဗမာ'], ['as', 'অসমীয়া'], ['or', 'ଓଡ଼ିଆ'],
  ['sd', 'سنڌي'], ['yi', 'ייִדיש'], ['haw', 'ʻŌlelo Hawaiʻi'], ['sm', 'Gagana Samoa'],
  ['mi', 'Te Reo Māori'], ['jv', 'Basa Jawa'], ['su', 'Basa Sunda'], ['ceb', 'Cebuano'],
  ['fil', 'Filipino'], ['ht', 'Kreyòl ayisyen'], ['eo', 'Esperanto'], ['la', 'Latina'],
  ['fy', 'Frysk'], ['lb', 'Lëtzebuergesch'], ['gd', 'Gàidhlig'], ['co', 'Corsu'],
  ['hmn', 'Hmoob'], ['qu', 'Runasimi'], ['ay', 'Aymar'], ['haw-US', 'ʻŌlelo Hawaiʻi (US)'],
].map(([code, name]) => ({ code, name }));
