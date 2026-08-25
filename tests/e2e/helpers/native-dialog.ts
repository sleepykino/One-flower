import { exec } from 'node:child_process';

/**
 * 原生系统对话框（plugin-dialog ask/confirm）自动化。
 *
 * 背景：CDP 无法操作 OS 级弹窗；覆盖 __TAURI_INTERNALS__.invoke 亦无法拦截
 * （已在阶段 1 手工验证，见 doc/自动化测试记录.md）。
 * 有效方案：PowerShell AppActivate 激活弹窗窗口后发送按键。
 */
const DIALOG_TITLE = '确认操作';

function sendKeysOnce(title: string, keys: string): Promise<boolean> {
  return new Promise((resolve) => {
    const script =
      `$ws = New-Object -ComObject WScript.Shell; ` +
      `$ok = $ws.AppActivate('${title}'); ` +
      `Start-Sleep -Milliseconds 300; ` +
      `if ($ok) { $ws.SendKeys('${keys}') }; ` +
      `if (-not $ok) { exit 1 }`;
    exec(script, { shell: 'powershell.exe' }, (err) => resolve(!err));
  });
}

async function sendKeys(title: string, keys: string, attempts = 10, intervalMs = 250): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await sendKeysOnce(title, keys)) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`未能激活原生对话框窗口"${title}"（请确认弹窗已触发、标题一致且无其他窗口抢占焦点）`);
}

/** 点击原生确认弹窗的"是/确定"（默认按钮）；title 缺省为通用确认框「确认操作」 */
export function acceptNativeDialog(title: string = DIALOG_TITLE): Promise<void> {
  return sendKeys(title, '{ENTER}');
}

/** 取消原生确认弹窗（ESC 等价于"否/取消"） */
export function dismissNativeDialog(title: string = DIALOG_TITLE): Promise<void> {
  return sendKeys(title, '{ESC}');
}
