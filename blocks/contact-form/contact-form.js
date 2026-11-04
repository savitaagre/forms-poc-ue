import { loadCSS } from '../../scripts/aem.js';
import { renderForm } from '../form/form.js';
import { submitSuccess, submitFailure } from '../form/submit.js';
import { checkValidation } from '../form/util.js';

const DEFAULT_THANK_YOU = 'Thank you! We\'ll get back to you within 2 business days.';
const NOT_CONNECTED_MSG = 'This form is not connected yet. Please try again later.';
const MAILTO_MSG = 'Your email app should now open with your message. Please press Send there to contact us.';

function field(id, fieldType, label, extra = {}) {
  return {
    id, fieldType, name: id, type: 'string', label: { value: label }, ...extra,
  };
}

// Field definitions for the standard contact form, in Adaptive Form JSON format
const CONTACT_FIELDS = [
  field('fullName', 'text-input', 'Full Name', {
    required: true, maxLength: 100, placeholder: 'Your full name', properties: { colspan: '6' },
  }),
  field('email', 'email', 'Email', {
    required: true, format: 'email', placeholder: 'you@example.com', properties: { colspan: '6' },
  }),
  field('phone', 'text-input', 'Phone', {
    placeholder: '10-digit phone number', properties: { colspan: '6' },
  }),
  field('subject', 'drop-down', 'Subject', {
    required: true,
    placeholder: 'Select a subject',
    enum: ['general', 'sales', 'support', 'feedback'],
    enumNames: ['General Enquiry', 'Sales', 'Support', 'Feedback'],
    properties: { colspan: '6' },
  }),
  field('company', 'text-input', 'Company', {
    placeholder: 'Company name (optional)', properties: { colspan: '12' },
  }),
  field('message', 'multiline-input', 'Message', {
    required: true, minLength: 10, maxLength: 1000, placeholder: 'How can we help?', properties: { colspan: '12' },
  }),
  field('consent', 'checkbox', 'I agree to be contacted about my enquiry', {
    required: true, enum: ['yes'], properties: { colspan: '12' },
  }),
  field('reset', 'button', 'Clear', {
    buttonType: 'reset',
    properties: { 'fd:buttonType': 'reset', colspan: '6' },
    events: { click: ["dispatchEvent('reset')"] },
  }),
  field('submit', 'button', 'Send Message', {
    buttonType: 'submit', properties: { 'fd:buttonType': 'submit', colspan: '6' },
  }),
];

/**
 * Reads the authored block config: row 1 = submit URL, row 2 = thank-you message.
 * In Universal Editor the rows carry data-aue-prop, which is used when present.
 */
function readConfig(block) {
  const rows = [...block.children];
  const config = {};
  rows.forEach((row, i) => {
    const cell = row.querySelector('[data-aue-prop]') || row.firstElementChild || row;
    const prop = cell.dataset?.aueProp || (i === 0 ? 'submitUrl' : 'thankYouMessage');
    const link = cell.querySelector('a[href]');
    config[prop] = (prop === 'submitUrl' && link ? link.href : cell.textContent).trim();
  });
  // a single filled row may be the thank-you message when the URL is empty
  if (rows.length === 1 && config.submitUrl && !/^(https?:\/\/|mailto:)/i.test(config.submitUrl)) {
    config.thankYouMessage = config.submitUrl;
    config.submitUrl = '';
  }
  return config;
}

function toPayload(form) {
  const data = {};
  [...form.elements].forEach((el) => {
    if (!el.name || el.matches('button') || el.disabled) return;
    if (el.type === 'checkbox') {
      data[el.name] = el.checked ? el.value : '';
    } else {
      data[el.name] = el.value;
    }
  });
  // flat field map: what email form services and most APIs expect
  return data;
}

/**
 * Builds a mailto: link with the visitor's answers, using field labels and
 * the selected option text, so it reads well in the recipient's inbox.
 */
function toMailtoUrl(form, mailto) {
  const [address] = mailto.replace(/^mailto:/i, '').split('?');
  const lines = [];
  let topic = '';
  CONTACT_FIELDS.filter((fd) => fd.fieldType !== 'button').forEach((fd) => {
    const el = form.elements[fd.name];
    if (!el) return;
    let value = el.value || '';
    if (el.tagName === 'SELECT') value = el.selectedOptions[0]?.value ? el.selectedOptions[0].text : '';
    if (el.type === 'checkbox') value = el.checked ? 'Yes' : 'No';
    if (fd.name === 'subject') topic = value;
    lines.push(fd.name === 'message' ? `\n${fd.label.value}:\n${value}` : `${fd.label.value}: ${value}`);
  });
  const subject = topic ? `Contact form: ${topic}` : 'Contact form';
  return `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}

function showMailtoMessage(form) {
  let note = form.parentNode.querySelector('.form-message.success-message');
  if (!note) {
    note = document.createElement('div');
    note.className = 'form-message success-message';
    form.parentNode.insertBefore(note, form);
  }
  note.textContent = MAILTO_MSG;
  form.setAttribute('data-submitting', 'false');
  form.querySelector('button[type="submit"]').disabled = false;
}

async function onSubmit(e, form, { submitUrl, thankYouMessage }) {
  e.preventDefault();
  form.dataset.thankYouMsg = thankYouMessage || DEFAULT_THANK_YOU;
  if (!form.checkValidity()) {
    form.querySelectorAll('input, select, textarea').forEach((el) => checkValidation(el));
    return;
  }
  if (!submitUrl) {
    submitFailure(e, form);
    form.querySelector('.form-message.error-message').textContent = NOT_CONNECTED_MSG;
    return;
  }
  if (/^mailto:/i.test(submitUrl)) {
    // keep the answers in the form in case no email app opens
    form.querySelector('.form-message.error-message')?.remove();
    window.open(toMailtoUrl(form, submitUrl), '_self');
    showMailtoMessage(form);
    return;
  }
  try {
    const resp = await fetch(submitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(toPayload(form)),
    });
    if (!resp.ok) throw new Error(`Submit failed: ${resp.status}`);
    form.querySelector('.form-message.error-message')?.remove();
    // clear through the reset button so the form model is reset too
    form.querySelector('button[type="reset"]')?.click();
    submitSuccess({ payload: {} }, form);
  } catch (err) {
    submitFailure(err, form);
  }
}

export default async function decorate(block) {
  const config = readConfig(block);

  // reuse the form block styling
  await loadCSS(`${window.hlx.codeBasePath}/blocks/form/form.css`);
  block.classList.add('form');
  block.parentElement?.classList.add('form-wrapper');
  block.closest('.section')?.classList.add('form-container');
  block.replaceChildren();

  const formDef = {
    id: 'contact-form',
    fieldType: 'form',
    title: 'Contact Us',
    action: window.location.pathname,
    adaptiveform: '0.12.1',
    metadata: { version: '1.0.0', grammar: 'json-formula-1.0.0' },
    items: CONTACT_FIELDS,
  };
  await renderForm(formDef, block);
  // keep submit clicks away from the form model, which would post to the page URL;
  // the native submit event still fires and is handled below
  block.addEventListener('click', (e) => {
    if (e.target.closest('button[type="submit"]')) e.stopPropagation();
  }, true);
  // clear a field's error while typing, so the layout doesn't jump on blur
  block.addEventListener('input', (e) => {
    if (e.target.closest('.field-invalid') && e.target.validity?.valid) checkValidation(e.target);
  });
  // listen on the block: the form engine replaces the <form> element on reset
  block.addEventListener('submit', (e) => onSubmit(e, e.target, config));
}
