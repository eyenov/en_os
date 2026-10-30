import { getHealth, getProviders, providerHasEnvKey, testConnection } from '../api.js';
import { clearAllData, getSettings, resetSettings, saveSettings } from '../store.js';
import { h, icon, modal, toast } from '../ui.js';

export async function renderSettings(ctx) {
  const providers = getProviders();
  let activeId = getSettings().provider;
  let keyVisible = false;
  let youtubeVisible = false;
  let testing = false;
  let draft = {
    keys: { ...getSettings().keys },
    baseUrls: { ...getSettings().baseUrls },
    models: { ...getSettings().models },
  };

  const provider = () => providers.find((item) => item.id === activeId) || providers[0];
  const el = h('div', {});
  const tabs = h('div', { class: 'provider-tabs' });
  const panel = h('div', {});
  const testResult = h('div', { class: 'test-result' });
  const healthNote = h('div', { class: 'callout', style: 'margin-top:4px' });

  function persist(extra = {}) {
    saveSettings({
      provider: activeId,
      keys: { [activeId]: draft.keys[activeId] || '' },
      baseUrls: { [activeId]: draft.baseUrls[activeId] || provider().baseUrl },
      models: { [activeId]: draft.models[activeId] || provider().model },
      ...extra,
    });
  }

  function renderTabs() {
    tabs.replaceChildren(...providers.map((item) => h('button', {
      class: `provider-tab${item.id === activeId ? ' active' : ''}`,
      type: 'button',
      onclick: () => {
        activeId = item.id;
        persist();
        renderTabs();
        renderPanel();
      },
    }, h('strong', {}, item.label), h('span', {}, item.model))));
  }

  function renderPanel() {
    const meta = provider();
    const key = draft.keys[activeId] || '';
    const baseUrl = draft.baseUrls[activeId] || meta.baseUrl;
    const model = draft.models[activeId] || meta.model;
    const hasEnv = providerHasEnvKey(activeId);

    const keyInput = h('input', {
      class: 'input',
      type: keyVisible ? 'text' : 'password',
      value: key,
      placeholder: hasEnv ? '服务端已通过环境变量提供密钥（此处留空即可）' : 'sk-… 只保存在本机 localStorage',
      autocomplete: 'off',
      spellcheck: 'false',
      oninput: (event) => {
        draft.keys[activeId] = event.target.value.trim();
        persist();
        updateHealthNote();
      },
    });

    const baseInput = h('input', {
      class: 'input',
      type: 'url',
      value: baseUrl,
      spellcheck: 'false',
      onchange: (event) => {
        draft.baseUrls[activeId] = event.target.value.trim() || meta.baseUrl;
        persist();
      },
    });

    const modelInput = h('input', {
      class: 'input',
      type: 'text',
      value: model,
      list: 'model-options',
      spellcheck: 'false',
      onchange: (event) => {
        draft.models[activeId] = event.target.value.trim() || meta.model;
        persist();
      },
    });

    const modelList = h('datalist', { id: 'model-options' }, (meta.models || []).map((name) => h('option', { value: name })));

    const aiToggle = h('input', {
      type: 'checkbox',
      checked: getSettings().aiMode !== 'off',
      onchange: (event) => {
        persist({ aiMode: event.target.checked ? 'auto' : 'off' });
        toast(event.target.checked ? '模型请求已开启' : '模型请求已关闭', 'ok', 2000);
      },
    });

    panel.replaceChildren(
      h('div', { class: 'field' },
        h('label', {}, 'API Key ', hasEnv ? h('span', { class: 'badge ok' }, '环境变量可用') : h('span', { class: 'badge' }, '仅存本机')),
        h('div', { class: 'key-row' }, keyInput,
          h('button', { class: 'icon-round', type: 'button', 'aria-label': keyVisible ? '隐藏密钥' : '显示密钥', onclick: () => {
            keyVisible = !keyVisible;
            renderPanel();
          } }, h('span', { html: icon(keyVisible ? 'lock' : 'key', 17) })),
        ),
        h('div', { class: 'hint' }, '浏览器密钥以明文保存在 localStorage，请勿在共享设备上保存。也可改用服务端环境变量。'),
      ),
      h('div', { class: 'field-row' },
        h('div', { class: 'field' }, h('label', {}, 'Base URL'), baseInput,
          h('div', { class: 'hint' }, `默认 ${meta.baseUrl}`)),
        h('div', { class: 'field' }, h('label', {}, '模型'), modelInput, modelList,
          h('div', { class: 'hint' }, meta.models?.length ? `常用：${meta.models.join(' / ')}` : '填写服务商提供的模型 ID')),
      ),
      healthNote,
      h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px' },
        h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: runTest, disabled: testing }, testing ? '测试中…' : '测试连接'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => {
          draft.baseUrls[activeId] = meta.baseUrl;
          draft.models[activeId] = meta.model;
          persist();
          renderPanel();
          toast('已恢复默认地址与模型', 'ok', 1800);
        } }, '恢复默认'),
        meta.docs ? h('a', { class: 'link-btn', href: meta.docs, target: '_blank', rel: 'noreferrer' }, '获取 API Key ↗') : null,
      ),
      testResult,
      h('div', { class: 'switch-row' },
        h('div', {}, h('p', {}, '模型翻译与问答'), h('small', {}, '关闭后不自动请求模型；字幕仍可能通过免费翻译服务处理。')),
        h('label', { class: 'switch' }, aiToggle, h('span', { class: 'track' }), h('span', { class: 'thumb' })),
      ),
    );
    updateHealthNote();
  }

  function updateHealthNote() {
    const hasEnv = providerHasEnvKey(activeId);
    const typed = Boolean((draft.keys[activeId] || '').trim());
    if (hasEnv || typed) {
      healthNote.className = 'callout ok';
      healthNote.innerHTML = `${icon('check', 16)}<span>${hasEnv ? '服务端环境中检测到该服务商的密钥。' : '密钥已在本次会话中，可以点“测试连接”验证。'}</span>`;
    } else {
      healthNote.className = 'callout';
      healthNote.innerHTML = `${icon('info', 16)}<span>尚未配置模型密钥。</span>`;
    }
  }

  async function runTest() {
    if (testing) return;
    persist();
    testing = true;
    testResult.className = 'test-result';
    testResult.textContent = '正在请求…';
    renderPanel();
    try {
      const result = await testConnection(getSettings());
      testResult.className = 'test-result ok';
      testResult.textContent = `连接成功 · ${result.latency}ms · 模型 ${result.model || '—'}`;
      toast('连接成功', 'ok', 2000);
    } catch (error) {
      testResult.className = 'test-result err';
      testResult.textContent = `连接失败：${error.message}`;
      toast('连接失败，请检查 Key、Base URL 与模型名。', 'err', 4200);
    } finally {
      testing = false;
      renderTabs();
      renderPanel();
    }
  }

  const youtubeKeyInput = h('input', {
    class: 'input',
    type: youtubeVisible ? 'text' : 'password',
    value: getSettings().youtubeKey || '',
    placeholder: 'AIza…（可选；留空则尝试网页检索）',
    autocomplete: 'off',
    spellcheck: 'false',
    oninput: (event) => saveSettings({ youtubeKey: event.target.value.trim() }),
  });
  const youtubeCard = h('div', { class: 'card settings-card' },
    h('h3', {}, h('span', { html: icon('play', 18) }), 'YouTube 视频搜索'),
    h('p', { class: 'small muted', style: 'margin-top:6px' }, '关键词搜索、缩略图与逐词双语字幕。配置 Data API v3 Key 后结果更稳定；不配置时会尝试公开搜索结果页。'),
    h('div', { class: 'field', style: 'margin-top:14px' },
      h('label', {}, 'YouTube Data API Key ', h('span', { class: 'badge' }, '仅用于视频搜索')),
      h('div', { class: 'key-row' }, youtubeKeyInput,
        h('button', { class: 'icon-round', type: 'button', 'aria-label': youtubeVisible ? '隐藏密钥' : '显示密钥', onclick: () => {
          youtubeVisible = !youtubeVisible;
          youtubeKeyInput.type = youtubeVisible ? 'text' : 'password';
        } }, h('span', { html: icon(youtubeVisible ? 'lock' : 'key', 17) })),
      ),
      h('div', { class: 'hint' }, '也可以给服务端设置 YOUTUBE_API_KEY 环境变量。Key 只保存在本机，不写入日志。'),
    ),
    h('div', { class: 'callout', style: 'margin-top:4px', html: `${icon('info', 16)}<span>逐词字幕来自 YouTube 的公开字幕轨。并非所有视频都有字幕；没有字幕的视频仍可播放，但不会显示高亮。没有官方中文字幕时，可用当前 AI 服务商生成。</span>` }),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px' },
      h('a', { class: 'link-btn', href: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com', target: '_blank', rel: 'noreferrer' }, '申请 YouTube Data API Key ↗'),
      h('a', { class: 'link-btn', href: '/videos.html' }, '打开视频检索 →'),
    ),
  );

  const dataCard = h('div', { class: 'card settings-card' },
    h('h3', {}, h('span', { html: icon('trash', 18) }), '本机数据'),
    h('p', { class: 'small muted', style: 'margin-top:6px' }, '浏览器中保存的密钥、模型配置和播放偏好。清空不会更改服务端环境变量。'),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px' },
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
        const ok = await modal({ title: '清空本机数据？', body: '会删除本应用在此浏览器中保存的密钥、配置与播放偏好。此操作不可撤销。', actions: [{ label: '取消', value: false }, { label: '清空', value: true, primary: true }] });
        if (!ok) return;
        clearAllData();
        refreshDraft();
        toast('本机数据已清空', 'ok');
        ctx.navigate();
      } }, '清空全部数据'),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
        const ok = await modal({ title: '恢复默认设置？', body: '服务商、模型与模型开关恢复默认。已保存的模型密钥和 YouTube 密钥会保留。', actions: [{ label: '取消', value: false }, { label: '恢复', value: true, primary: true }] });
        if (!ok) return;
        const { keys, youtubeKey } = getSettings();
        resetSettings();
        saveSettings({ keys, youtubeKey });
        refreshDraft();
        toast('已恢复默认设置', 'ok');
      } }, '恢复默认设置'),
    ),
  );

  const explainer = h('div', { class: 'card settings-card' },
    h('h3', {}, h('span', { html: icon('lock', 18) }), '密钥与隐私'),
    h('div', { class: 'callout', style: 'margin-top:10px', html: `${icon('info', 16)}<span>没有账号或服务端密钥存储。模型请求由 Node 服务转发到所选 Base URL；字幕上下文和问题会发送给对应服务商。请只使用可信地址。</span>` }),
    h('div', { class: 'callout', style: 'margin-top:8px', html: `${icon('lock', 16)}<span>环境密钥仅可用于服务端配置的模型地址。YouTube、播客、图书和免费字幕翻译也需要访问各自的第三方服务。本应用默认仅供本机使用。</span>` }),
  );

  el.append(
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, 'Settings'),
      h('h1', {}, '设置'),
      h('p', { class: 'lede' }, '模型服务、YouTube 搜索与本机数据。'),
    ),
    h('div', { class: 'settings-grid' },
      h('div', {},
        h('div', { class: 'card settings-card' },
          h('h3', {}, h('span', { html: icon('key', 18) }), '服务商'),
          h('p', { class: 'small muted', style: 'margin-top:6px' }, '用于字幕翻译和视频内问答；自定义服务需兼容 OpenAI /chat/completions。'),
          tabs,
          panel,
        ),
        youtubeCard,
        dataCard,
      ),
      h('div', {},
        explainer,
      ),
    ),
  );

  function refreshDraft() {
    const settings = getSettings();
    activeId = settings.provider;
    draft = { keys: { ...settings.keys }, baseUrls: { ...settings.baseUrls }, models: { ...settings.models } };
    youtubeKeyInput.value = settings.youtubeKey;
    renderTabs();
    renderPanel();
  }

  renderTabs();
  renderPanel();
  getHealth().then(() => { renderPanel(); });

  return { el, title: '设置 · EnOS' };
}
