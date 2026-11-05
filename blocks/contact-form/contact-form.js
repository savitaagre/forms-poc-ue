import { loadCSS } from '../../scripts/aem.js';
import { renderForm } from '../form/form.js';
import { submitSuccess } from '../form/submit.js';
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
  // button names must not be 'reset'/'submit': they would shadow form.reset()/form.submit()
  field('clear', 'button', 'Clear', {
    buttonType: 'reset',
    properties: { 'fd:buttonType': 'reset', colspan: '6' },
    events: { click: ["dispatchEvent('reset')"] },
  }),
  field('send', 'button', 'Send Message', {
    buttonType: 'submit', properties: { 'fd:buttonType': 'submit', colspan: '6' },
  }),
];

/**
 * Reads the authored thank-you message. In Universal Editor the cell carries
 * data-aue-prop; otherwise it is the last row (older content also had a
 * submit URL row before it, which is ignored).
 */
function readThankYouMessage(block) {
  const authored = block.querySelector('[data-aue-prop="thankYouMessage"]');
  const lastRow = block.lastElementChild;
  return (authored || lastRow)?.textContent.trim() || '';
}

function onSubmit(e, form, thankYouMessage) {
  e.preventDefault();
  if (!form.checkValidity()) {
    form.querySelectorAll('input, select, textarea').forEach((el) => checkValidation(el));
    return;
  }
  // the answers are not sent anywhere: just thank the visitor and clear the form
  form.dataset.thankYouMsg = thankYouMessage || DEFAULT_THANK_YOU;
  form.querySelector('button[type="reset"]')?.click();
  submitSuccess({ payload: {} }, form);
}

export default async function decorate(block) {
  const thankYouMessage = readThankYouMessage(block);

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
  block.addEventListener('submit', (e) => onSubmit(e, e.target, thankYouMessage));
}
