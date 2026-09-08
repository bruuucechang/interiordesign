import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseLang } from '../src/core/i18n';

// 第一次進來要開哪一種語言。
//
// 使用者的朋友「英文不好」，而 `navigator.language` 講的是**瀏覽器**的語言，不是
// 那個人的語言——兩者常常不一致：很多看中文的人用的是英文版 Chrome，因為電腦出廠
// 就是那樣。桌面版是交給一個特定的人、由知道他讀什麼的人交出去的，所以啟動器直接
// 用 `?lang=zh-Hant` 講明白，不要讓前端從瀏覽器去猜。
//
// 賭注是不對稱的，這才是這個順序的理由：英文那一側本來就還沒翻完（家具與材質名、
// 快捷鍵表、提示列都還是中文），猜錯成英文＝交給他一個半調子的介面；猜錯成中文＝
// 他多按一次那顆一直都在的切換鈕。

const B = (browser: string) => ({ saved: null, asked: null, browser });

test('桌面版帶 ?lang=zh-Hant，瀏覽器是英文也要開中文', () => {
  assert.equal(chooseLang({ saved: null, asked: 'zh-Hant', browser: 'en-US' }), 'zh-Hant');
});

test('使用者自己選過的永遠優先，啟動器蓋不掉', () => {
  assert.equal(chooseLang({ saved: 'en', asked: 'zh-Hant', browser: 'zh-TW' }), 'en',
    '切成英文之後，下一次啟動不能把它改回去');
});

test('沒有參數時維持原本看瀏覽器的行為', () => {
  assert.equal(chooseLang(B('zh-TW')), 'zh-Hant');
  assert.equal(chooseLang(B('zh-Hans-CN')), 'zh-Hant');
  assert.equal(chooseLang(B('en-GB')), 'en');
  assert.equal(chooseLang(B('')), 'en');
});

test('參數或存檔是垃圾就忽略，不要變成一個沒有翻譯的語言', () => {
  assert.equal(chooseLang({ saved: null, asked: 'fr', browser: 'zh-TW' }), 'zh-Hant');
  assert.equal(chooseLang({ saved: 'ja', asked: null, browser: 'en-US' }), 'en');
  assert.equal(chooseLang({ saved: 'zh-Hans', asked: null, browser: 'zh-TW' }), 'zh-Hant');
});
