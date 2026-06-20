# CodeBuddy CN Automation Fix Summary

## 问题诊断 (Problem Diagnosis)

通过实际访问 CodeBuddy CN 网站，发现登录流程的 DOM 结构与预期不符：

1. **主登录按钮位置问题**: 按钮在 `.mobile-actions` 中，但 Playwright 的 viewport 检查失败
2. **嵌套 iframe 结构**: 
   - 第一层: `https://www.codebuddy.cn/login` - 登录模态框
   - 第二层: `/auth/realms/copilot/protocol/openid-connect/auth` - 手机号输入框
3. **需要多步操作**:
   - 点击主登录按钮
   - 勾选同意条款复选框
   - 点击"手机号"选项
   - 等待嵌套 iframe 加载

## 修复内容 (Fixes Applied)

### 1. clickPrimaryCodeBuddyCnLoginButton
**之前**: 使用 Playwright locator，受 viewport 限制
**现在**: 使用 JavaScript 直接查找并点击 `.mobile-actions .btn-login`

```javascript
// 使用 page.evaluate 直接操作 DOM，绕过 viewport 检查
const clicked = await page.evaluate(() => {
  const mobileBtn = document.querySelector('.mobile-actions .btn-login');
  if (mobileBtn) {
    mobileBtn.click();
    return true;
  }
  // ...
});
```

### 2. getCodeBuddyCnLoginFrame
**之前**: 只匹配 `/login/` URL
**现在**: 匹配多种 URL 模式
```javascript
return url.includes("https://www.codebuddy.cn/login") || 
       url.includes("/login?platform=website");
```

### 3. getCodeBuddyCnPhoneFrame (新函数)
新增函数检测嵌套的手机号输入 iframe：
```javascript
function getCodeBuddyCnPhoneFrame(page) {
  return page.frames().find((frame) => {
    const url = frame.url();
    return url.includes("/auth/realms/copilot/protocol/openid-connect/auth") ||
           url.includes("phone-iframe");
  }) || null;
}
```

### 4. clickPhoneLoginInModal (新函数)
处理登录模态框内的复选框和手机号选项点击：
```javascript
// 1. 勾选同意条款复选框
await loginFrame.evaluate(() => {
  const checkbox = document.querySelector('.t-checkbox__former');
  if (checkbox) {
    checkbox.click();
    if (!checkbox.checked) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
});

// 2. 点击"手机号"选项
const clicked = await loginFrame.evaluate(() => {
  const allEls = Array.from(document.querySelectorAll('div, span, a, p, li'));
  for (const el of allEls) {
    if (el.children.length === 0 && (el.textContent || '').trim() === '手机号') {
      const target = el.closest('[class*="item"]') || el.parentElement || el;
      target.click();
      return true;
    }
  }
  return false;
});
```

### 5. openCodeBuddyCnLoginUi (完全重写)
新的步骤流程：
```
Step 1: 点击主登录按钮
Step 2: 等待登录 iframe 出现 (最多 8 次尝试)
Step 3: 检查嵌套手机号 iframe 是否已就绪
Step 4: 点击复选框 + "手机号"选项
Step 5: 等待并验证嵌套 iframe 加载
Step 6: 返回嵌套 iframe 作为目标
```

### 6. fillPhoneInput
**新增精确选择器**:
```javascript
// 优先使用精确选择器
const phoneInput = document.querySelector('#phoneNumber') || 
                   document.querySelector('input.kc-phone-number-input') ||
                   document.querySelector('input[placeholder*="手机"]');
```

### 7. fillOtpInput
**新增精确选择器**:
```javascript
// 优先使用精确选择器
const otpInput = document.querySelector('#code') || 
                 document.querySelector('input.pf-c-form-control') ||
                 document.querySelector('input[placeholder*="验证码"]');
```

### 8. OTP 发送按钮点击
**新增在嵌套 iframe 内点击**:
```javascript
const clicked = await loginSurface.evaluate(() => {
  // 策略 1: 精确选择器
  const sendBtn = document.querySelector('.code-btn') || 
                  document.querySelector('input.code-btn') ||
                  document.querySelector('button.code-btn');
  if (sendBtn) {
    sendBtn.click();
    return true;
  }
  
  // 策略 2: 文本匹配
  const buttons = Array.from(document.querySelectorAll('button, input[type="button"], a'));
  for (const btn of buttons) {
    const text = (btn.textContent || btn.value || '').trim().toLowerCase();
    if (/(send|get|获取|发送|验证码)/i.test(text)) {
      btn.click();
      return true;
    }
  }
  return false;
});
```

## 测试验证 (Testing)

代码已通过语法检查，无错误。现在可以：

1. **重启应用**: 停止并重新启动 Next.js 开发服务器
2. **运行自动化任务**: 在 dashboard 中创建新的 CodeBuddy CN 自动化任务
3. **监控日志**: 检查 automation logs 确认：
   - ✅ 成功点击主登录按钮
   - ✅ 成功检测到登录 iframe
   - ✅ 成功点击"手机号"选项
   - ✅ 成功填充手机号
   - ✅ 成功发送 OTP 请求
   - ✅ 成功填充 OTP 并提交

## 文件修改清单 (Files Modified)

- `src/lib/oauth/services/codebuddyCnAutomationManager.js`
  - Line ~280: `clickPrimaryCodeBuddyCnLoginButton` - 重写
  - Line ~310: `getCodeBuddyCnLoginFrame` - 更新 URL 匹配
  - Line ~315: `getCodeBuddyCnPhoneFrame` - 新增
  - Line ~340: `hasCodeBuddyCnAuthInputs` - 保留
  - Line ~360: `clickPhoneLoginInModal` - 新增
  - Line ~420: `openCodeBuddyCnLoginUi` - 完全重写
  - Line ~480: `fillPhoneInput` - 添加精确选择器
  - Line ~510: `fillOtpInput` - 添加精确选择器
  - Line ~750: OTP 请求逻辑 - 更新为在嵌套 iframe 中点击

## 下一步 (Next Steps)

1. 重启开发服务器
2. 运行测试自动化任务
3. 如果仍有问题，检查浏览器控制台错误和 automation logs
4. 根据实际运行结果进一步优化选择器
