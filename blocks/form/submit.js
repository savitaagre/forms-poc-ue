import { DEFAULT_THANK_YOU_MESSAGE, getSubmitBaseUrl } from './constant.js';

export function submitSuccess(e, form) {
  const { payload } = e;
  const redirectUrl = form.dataset.redirectUrl || payload?.body?.redirectUrl;
  const thankYouMsg = form.dataset.thankYouMsg || payload?.body?.thankYouMessage;
  if (redirectUrl) {
    window.location.assign(encodeURI(redirectUrl));
  } else {
    let thankYouMessage = form.parentNode.querySelector('.form-message.success-message');
    if (!thankYouMessage) {
      thankYouMessage = document.createElement('div');
      thankYouMessage.className = 'form-message success-message';
    }
    thankYouMessage.innerHTML = thankYouMsg || DEFAULT_THANK_YOU_MESSAGE;
    form.parentNode.insertBefore(thankYouMessage, form);
    if (thankYouMessage.scrollIntoView) {
      thankYouMessage.scrollIntoView({ behavior: 'smooth' });
    }
    form.reset();
  }
  form.setAttribute('data-submitting', 'false');
  form.querySelector('button[type="submit"]').disabled = false;
}

export function submitFailure(e, form) {
  let errorMessage = form.querySelector('.form-message.error-message');
  if (!errorMessage) {
    errorMessage = document.createElement('div');
    errorMessage.className = 'form-message error-message';
  }
  errorMessage.innerHTML = 'Some error occured while submitting the form'; // TODO: translation
  form.prepend(errorMessage);
  errorMessage.scrollIntoView({ behavior: 'smooth' });
  form.setAttribute('data-submitting', 'false');
  form.querySelector('button[type="submit"]').disabled = false;
}

function generateUnique() {
  return new Date().valueOf() + Math.random();
}

function getFieldValue(fe, payload) {
  if (fe.type === 'radio') {
    return fe.form.elements[fe.name].value;
  } if (fe.type === 'checkbox') {
    if (payload[fe.name]) {
      if (fe.checked) {
        return `${payload[fe.name]},${fe.value}`;
      }
      return payload[fe.name];
    } if (fe.checked) {
      return fe.value;
    }
  } else if (fe.type !== 'file') {
    return fe.value;
  }
  return null;
}

function constructPayload(form) {
  const payload = { __id__: generateUnique() };
  [...form.elements].forEach((fe) => {
    if (fe.name && !fe.matches('button') && !fe.disabled && fe.tagName !== 'FIELDSET') {
      const value = getFieldValue(fe, payload);
      if (fe.closest('.repeat-wrapper')) {
        payload[fe.name] = payload[fe.name] ? `${payload[fe.name]},${fe.value}` : value;
      } else {
        payload[fe.name] = value;
      }
    }
  });
  return { payload };
}

async function prepareRequest(form) {
  const { payload } = constructPayload(form);
  const headers = {
    'Content-Type': 'application/json',
    // eslint-disable-next-line comma-dangle
    'x-adobe-form-hostname': window?.location?.hostname
  };
  const body = { data: payload };
  let url;
  let baseUrl = getSubmitBaseUrl();
  if (!baseUrl) {
    // eslint-disable-next-line prefer-template
    baseUrl = 'https://forms.adobe.com/adobe/forms/af/submit/';
    url = baseUrl + btoa(`${form.dataset.action}.json`);
  } else {
    url = form.dataset.action;
  }
  return { headers, body, url };
}

async function submitDocBasedForm(form, captcha) {
  try {
    const { headers, body, url } = await prepareRequest(form, captcha);
    let token = null;
    if (captcha) {
      token = await captcha.getToken();
      body.data['g-recaptcha-response'] = token;
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (response.ok) {
      submitSuccess(response, form);
    } else {
      const error = await response.text();
      throw new Error(error);
    }
  } catch (error) {
    submitFailure(error, form);
  }
}

function answerOf(wrapper) {
  const select = wrapper.querySelector('select');
  if (select) return [...select.selectedOptions].filter((o) => o.value).map((o) => o.text).join(', ');
  const choices = wrapper.querySelectorAll(':scope .radio-wrapper input, :scope .checkbox-wrapper input');
  if (choices.length) {
    return [...choices].filter((c) => c.checked)
      .map((c) => c.parentElement.querySelector('label')?.textContent.trim() || c.value).join(', ');
  }
  const input = wrapper.querySelector('input, textarea');
  if (input?.type === 'checkbox') return input.checked ? 'Yes' : 'No';
  if (input?.type === 'file') {
    // email links can't carry files: name them so the visitor attaches them
    const names = [...(input.files || [])].map((f) => f.name);
    return names.length ? `${names.join(', ')} (please attach to this email)` : '';
  }
  return input?.value || '';
}

/**
 * Builds a mailto: link with the visitor's answers (field labels and displayed option text),
 * subject "<page title>: <subject field>" when the form has a field named "subject".
 */
export function buildMailtoUrl(form, sendTo) {
  const lines = [];
  const wrappers = new Set();
  [...form.elements].forEach((fe) => {
    if (!fe.name || fe.matches('button, fieldset') || fe.type === 'hidden') return;
    const wrapper = fe.closest('.field-wrapper');
    if (wrapper && !wrappers.has(wrapper)) wrappers.add(wrapper);
  });
  let topic = '';
  wrappers.forEach((wrapper) => {
    const label = wrapper.querySelector(':scope > .field-label')?.textContent.trim()
      || wrapper.querySelector('[name]')?.name || '';
    const value = answerOf(wrapper);
    if (wrapper.querySelector('[name="subject"]')) topic = value;
    lines.push(wrapper.querySelector('textarea') ? `\n${label}:\n${value}\n` : `${label}: ${value}`);
  });
  const title = document.title || 'Form submission';
  const subject = topic ? `${title}: ${topic}` : title;
  return `mailto:${sendTo}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}

// open the visitor's email app with their answers, then thank them and clear the form
function submitByEmail(form, holder) {
  window.open(buildMailtoUrl(form, holder.dataset.sendTo), '_self');
  // a reset replaces the form element, so the thank-you message is kept on the block
  form.dataset.thankYouMsg = form.dataset.thankYouMsg || holder.dataset.thankYouMsg || '';
  submitSuccess({ payload: {} }, form);
}

export async function handleSubmit(e, form, captcha) {
  e.preventDefault();

  const valid = form.checkValidity();
  if (valid) {
    e.submitter?.setAttribute('disabled', '');
    if (form.getAttribute('data-submitting') !== 'true') {
      form.setAttribute('data-submitting', 'true');

      // hide error message in case it was shown before
      form.querySelectorAll('.form-message.show').forEach((el) => el.classList.remove('show'));

      const emailHolder = form.closest('[data-send-to]');
      if (form.dataset.source === 'sheet' && emailHolder) {
        submitByEmail(form, emailHolder);
      } else if (form.dataset.source === 'sheet') {
        await submitDocBasedForm(form, captcha);
      }
    }
  } else {
    const firstInvalidEl = form.querySelector(':invalid:not(fieldset)');
    if (firstInvalidEl) {
      firstInvalidEl.focus();
      firstInvalidEl.scrollIntoView({ behavior: 'smooth' });
    }
  }
}
