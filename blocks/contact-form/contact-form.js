import { loadCSS } from '../../scripts/aem.js';
import { renderForm } from '../form/form.js';
import { submitFailure, submitSuccess } from '../form/submit.js';
import { checkValidation } from '../form/util.js';

const DEFAULT_THANK_YOU = 'Thank you! We\'ll get back to you within 2 business days.';

const COUNTRIES = [
  'Australia', 'Brazil', 'Canada', 'China', 'France', 'Germany', 'India', 'Ireland',
  'Italy', 'Japan', 'Mexico', 'Netherlands', 'New Zealand', 'Singapore', 'South Africa',
  'Spain', 'Sweden', 'Switzerland', 'United Arab Emirates', 'United Kingdom',
  'United States', 'Other',
];

function field(id, fieldType, label, extra = {}) {
  return {
    id, fieldType, name: id, type: 'string', label: { value: label }, ...extra,
  };
}

function formButtons(sendLabel) {
  return [
    // button names must not be 'reset'/'submit': they would shadow form.reset()/form.submit()
    field('clear', 'button', 'Clear', {
      buttonType: 'reset',
      properties: { 'fd:buttonType': 'reset', colspan: '6' },
      events: { click: ["dispatchEvent('reset')"] },
    }),
    field('send', 'button', sendLabel, {
      buttonType: 'submit', properties: { 'fd:buttonType': 'submit', colspan: '6' },
    }),
  ];
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
    placeholder: 'Company name (optional)', properties: { colspan: '6' },
  }),
  field('jobTitle', 'text-input', 'Job Title', {
    maxLength: 100, placeholder: 'Your job title (optional)', properties: { colspan: '6' },
  }),
  field('country', 'drop-down', 'Country', {
    placeholder: 'Select a country',
    enum: COUNTRIES,
    enumNames: COUNTRIES,
    properties: { colspan: '6' },
  }),
  field('preferredContact', 'radio-group', 'Preferred Contact Method', {
    enum: ['email', 'phone'],
    enumNames: ['Email', 'Phone'],
    properties: { colspan: '6', 'afs:layout': { orientation: 'horizontal' } },
  }),
  field('message', 'multiline-input', 'Message', {
    required: true, minLength: 10, maxLength: 1000, placeholder: 'How can we help?', properties: { colspan: '12' },
  }),
  field('attachment', 'file-input', 'Attachment', {
    type: 'file',
    accept: ['image/*', 'application/pdf'],
    description: 'Optional: a screenshot or PDF.',
    properties: { colspan: '12', dragDropText: 'Drag and drop a file here, or click to browse' },
  }),
  field('consent', 'checkbox', 'I agree to be contacted about my enquiry', {
    required: true, enum: ['yes'], properties: { colspan: '12' },
  }),
  ...formButtons('Send Message'),
];

// migrated-contactUs: migrated from the Ingram Micro supply chain services page form
const MIGRATED_CONTACT_US_FIELDS = [
  field('company', 'text-input', 'Company Name', { required: true, properties: { colspan: '12' } }),
  field('firstName', 'text-input', 'First name', { required: true, properties: { colspan: '6' } }),
  field('lastName', 'text-input', 'Last name', { required: true, properties: { colspan: '6' } }),
  field('email', 'email', 'Email address', { required: true, format: 'email', properties: { colspan: '6' } }),
  field('phone', 'text-input', 'Business phone', { properties: { colspan: '6' } }),
  field('howCanWeHelp', 'multiline-input', 'How can we help?', { required: true, properties: { colspan: '12' } }),
  field('consent', 'checkbox', 'By providing my Personal Data, including name and contact information to Ingram Micro and its subsidiaries I agree to be contacted for marketing purposes. Ingram Micro will collect and process your Personal Data in compliance with our global privacy statement.', {
    required: true, enum: ['yes'], properties: { colspan: '12' },
  }),
  ...formButtons('Submit'),
];

// Forms the block can show, chosen with the 'Form' setting in Universal Editor
const FORMS = {
  contact: { fields: CONTACT_FIELDS, title: 'Contact form' },
  'migrated-contactUs': { fields: MIGRATED_CONTACT_US_FIELDS, title: 'migrated-contactUs' },
};

// Google Apps Script web app that adds each submission as a row in a Google Sheet
const SHEET_URL_RE = /^https:\/\/script\.google(usercontent)?\.com\//i;
// short sheet column names for fields with long labels
const COLUMN_NAMES = { consent: 'Consent' };

/**
 * Reads the authored settings. In Universal Editor the cells carry data-aue-prop;
 * on the site each row is recognised by its content: a form key ('contact',
 * 'migrated-contactUs') picks the form, a Google Apps Script URL is the spreadsheet,
 * other text is the thank-you message (email addresses and other URLs from older
 * content are ignored).
 */
function readConfig(block) {
  const config = { formType: 'contact', spreadsheetUrl: '', thankYouMessage: '' };
  [...block.children].forEach((row) => {
    const cell = row.querySelector('[data-aue-prop]') || row;
    const link = cell.querySelector('a[href]');
    const text = (link ? link.getAttribute('href') : cell.textContent).trim();
    const prop = cell.dataset?.aueProp;
    if (prop === 'formType' || (!prop && FORMS[text])) {
      if (FORMS[text]) config.formType = text;
    } else if (prop === 'spreadsheetUrl' || (!prop && SHEET_URL_RE.test(text))) {
      if (SHEET_URL_RE.test(text)) config.spreadsheetUrl = text;
    } else if ((prop === 'thankYouMessage' || !prop) && text
      && !/^(https?|mailto):/i.test(text) && !/^[^\s@]+@[^\s@]+$/.test(text)) {
      config.thankYouMessage = text;
    }
  });
  return config;
}

/**
 * Reads the visitor's answers as { label, value } pairs, using field labels and the
 * displayed option text, so the spreadsheet reads well.
 */
function readAnswers(form, fields) {
  return fields.filter((fd) => fd.fieldType !== 'button').map((fd) => {
    const wrapper = form.querySelector(`[data-id="${fd.id}"]`);
    let value = '';
    if (!wrapper) {
      value = '';
    } else if (fd.fieldType === 'drop-down') {
      const option = wrapper.querySelector('select')?.selectedOptions[0];
      value = option?.value ? option.text : '';
    } else if (fd.fieldType === 'checkbox') {
      value = wrapper.querySelector('input')?.checked ? 'Yes' : 'No';
    } else if (fd.fieldType === 'radio-group') {
      value = wrapper.querySelector('input:checked')?.closest('.radio-wrapper')?.querySelector('label')?.textContent || '';
    } else if (fd.fieldType === 'file-input') {
      // spreadsheets can't hold files: record the file names only
      value = [...(wrapper.querySelector('input[type="file"]')?.files || [])].map((f) => f.name).join(', ');
    } else {
      value = wrapper.querySelector('input, textarea')?.value || '';
    }
    return { label: COLUMN_NAMES[fd.id] || fd.label.value, value: value.trim() };
  });
}

async function saveToSheet(url, body) {
  // text/plain keeps this a simple request, which Google Apps Script accepts cross-origin
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.result !== 'success') {
    throw new Error(result.error || `Spreadsheet responded with ${response.status}`);
  }
}

async function onSubmit(e, form, { formType, spreadsheetUrl, thankYouMessage }) {
  e.preventDefault();
  // the form engine's submit handler has already set data-submitting: track saving separately
  if (form.dataset.saving === 'true') return;
  if (!form.checkValidity()) {
    form.querySelectorAll('input, select, textarea').forEach((el) => checkValidation(el));
    return;
  }
  form.dataset.saving = 'true';
  form.querySelector('button[type="submit"]').disabled = true;
  form.querySelector('.form-message.error-message')?.remove();
  try {
    if (!spreadsheetUrl) throw new Error('No Spreadsheet URL is set on the Contact Form block');
    const { title, fields } = FORMS[formType];
    await saveToSheet(spreadsheetUrl, {
      form: title,
      page: window.location.href,
      answers: readAnswers(form, fields),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Contact form: could not save the submission', error);
    submitFailure(error, form);
    const message = form.querySelector('.form-message.error-message');
    if (message) message.textContent = 'Sorry, we couldn\'t send your message. Please try again.';
    return;
  } finally {
    delete form.dataset.saving;
  }
  // thank the visitor and clear the form
  form.dataset.thankYouMsg = thankYouMessage || DEFAULT_THANK_YOU;
  form.querySelector('button[type="reset"]')?.click();
  submitSuccess({ payload: {} }, form);
}

export default async function decorate(block) {
  const config = readConfig(block);

  // reuse the form block styling
  await loadCSS(`${window.hlx.codeBasePath}/blocks/form/form.css`);
  block.classList.add('form');
  block.parentElement?.classList.add('form-wrapper');
  block.closest('.section')?.classList.add('form-container');
  block.replaceChildren();

  const { fields, title } = FORMS[config.formType];
  const formDef = {
    id: `${config.formType}-form`,
    fieldType: 'form',
    title,
    action: window.location.pathname,
    adaptiveform: '0.12.1',
    metadata: { version: '1.0.0', grammar: 'json-formula-1.0.0' },
    items: fields,
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
