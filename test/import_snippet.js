/* Browser regression: real File/FileList change events, no mocked parser. */
(function () {
  const errors = [];
  window.addEventListener('error', e => errors.push(e.message));
  window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
  const wait = () => new Promise(resolve => setTimeout(resolve, 100));
  function select(input, files) {
    const transfer = new DataTransfer();
    files.forEach(f => transfer.items.add(f));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  async function until(check) {
    for (let i = 0; i < 50; i++) { if (check()) return; await wait(); }
    throw new Error('Import assertion timed out');
  }
  function assert(ok, message) { if (!ok) throw new Error(message); }
  window.addEventListener('load', async () => {
    const result = {};
    try {
      document.querySelector('[data-goto="work"]').click();
      const srt = '1\n00:00:01,000 --> 00:00:02,000\nHello world.\n';
      const picker = document.getElementById('textFilesInput');
      assert(picker.accept.includes('.srt') && picker.accept.includes('.txt'), 'Missing accepted formats');
      select(picker, [new File(['你好世界。'], '中文.TXT'), new File([srt], 'English.SRT')]);
      await until(() => document.querySelectorAll('.vtext').length === 2 && document.querySelectorAll('.vtext')[1].value === 'Hello world.');
      assert(document.querySelector('.vtext').value === '你好世界。', 'TXT content lost');
      assert(!document.getElementById('toStep2Btn').disabled, 'Next step disabled');
      result.batch = 'ok';
      const card = document.querySelectorAll('.vcard')[1];
      select(card.querySelector('.vfile'), [new File(['Replacement text.'], 'replace.txt')]);
      await until(() => card.querySelector('.vtext').value === 'Replacement text.');
      assert(!card.querySelector('[data-stats]').textContent.includes('台词'), 'Stale subtitle timeline');
      const saved = JSON.parse(localStorage.getItem('multialign_autosave_v1'));
      assert(!saved.versions[1].cues && saved.versions[1].text === 'Replacement text.', 'TXT save or timeline reset failed');
      result.replace = 'ok';
      select(card.querySelector('.vfile'), [new File([srt], 'again.srt')]);
      await until(() => card.querySelector('.vtext').value === 'Hello world.');
      result.card = 'ok';
      select(picker, [new File([''], 'empty.txt'), new File(['invalid subtitle'], 'bad.srt')]);
      await until(() => document.querySelectorAll('.toast').length >= 4);
      await wait(); await wait();
      assert(document.querySelectorAll('.vcard').length === 2, 'Failed files left empty versions');
      result.invalid = 'ok';
      result.errors = errors;
    } catch (e) { result.fatal = String(e); }
    const marker = document.createElement('div');
    marker.id = 'e2e-result';
    marker.dataset.result = JSON.stringify(result);
    document.body.appendChild(marker);
  });
})();
