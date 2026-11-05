import { loadCSS } from '../../scripts/aem.js';
import { renderForm } from '../form/form.js';
import { submitSuccess } from '../form/submit.js';
import { checkValidation } from '../form/util.js';

const DEFAULT_THANK_YOU = 'Thank you! We\'ll get back to you within 2 business days.';
// used until a 'Send to email' address is set on the block in Universal Editor
const DEFAULT_RECIPIENT = 'sagre@adobe.com';

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

const EMAIL_RE = /^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/;

/**
 * Reads the authored settings. In Universal Editor the cells carry data-aue-prop;
 * on the site each row is recognised by its content: a form key ('contact',
 * 'migrated-contactUs') picks the form, an email address is the recipient, other text
 * is the thank-you message (URLs from older content are ignored).
 */
function readConfig(block) {
  const config = { formType: 'contact', recipientEmail: '', thankYouMessage: '' };
  [...block.children].forEach((row) => {
    const cell = row.querySelector('[data-aue-prop]') || row;
    const link = cell.querySelector('a[href^="mailto:"]');
    const text = (link ? link.getAttribute('href').replace(/^mailto:/i, '') : cell.textContent).trim();
    const prop = cell.dataset?.aueProp;
    if (prop === 'formType' || (!prop && FORMS[text])) {
      if (FORMS[text]) config.formType = text;
    } else if (prop === 'recipientEmail' || (!prop && EMAIL_RE.test(text))) {
      config.recipientEmail = text;
    } else if ((prop === 'thankYouMessage' || !prop) && text && !/^https?:\/\//i.test(text)) {
      config.thankYouMessage = text;
    }
  });
  return config;
}

/**
 * Builds a mailto: link with the visitor's answers, using field labels and the
 * displayed option text, so it reads well in the recipient's inbox.
 */
function toMailtoUrl(form, recipient, { fields, title }) {
  const lines = [];
  let topic = '';
  fields.filter((fd) => fd.fieldType !== 'button').forEach((fd) => {
    const wrapper = form.querySelector(`[data-id="${fd.id}"]`);
    if (!wrapper) return;
    let value;
    if (fd.fieldType === 'drop-down') {
      const option = wrapper.querySelector('select')?.selectedOptions[0];
      value = option?.value ? option.text : '';
    } else if (fd.fieldType === 'checkbox') {
      value = wrapper.querySelector('input')?.checked ? 'Yes' : 'No';
    } else if (fd.fieldType === 'radio-group') {
      value = wrapper.querySelector('input:checked')?.closest('.radio-wrapper')?.querySelector('label')?.textContent || '';
    } else if (fd.fieldType === 'file-input') {
      // email links can't carry files: name them so the visitor attaches them
      const names = [...(wrapper.querySelector('input[type="file"]')?.files || [])].map((f) => f.name);
      value = names.length ? `${names.join(', ')} (please attach to this email)` : '';
    } else {
      value = wrapper.querySelector('input, textarea')?.value || '';
    }
    if (fd.id === 'subject') topic = value;
    lines.push(fd.fieldType === 'multiline-input' ? `\n${fd.label.value}:\n${value}\n` : `${fd.label.value}: ${value}`);
  });
  const subject = topic ? `${title}: ${topic}` : title;
  return `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}

function onSubmit(e, form, { formType, recipientEmail, thankYouMessage }) {
  e.preventDefault();
  if (!form.checkValidity()) {
    form.querySelectorAll('input, select, textarea').forEach((el) => checkValidation(el));
    return;
  }
  // open the visitor's email app with their answers, then thank them and clear the form
  window.open(toMailtoUrl(form, recipientEmail || DEFAULT_RECIPIENT, FORMS[formType]), '_self');
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
