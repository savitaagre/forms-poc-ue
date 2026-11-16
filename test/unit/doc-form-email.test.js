/* eslint-env mocha */
import assert from 'assert';
import Sinon from 'sinon';
import decorate from '../../blocks/form/form.js';
import { resetIds } from '../../blocks/form/util.js';

const formPath = 'http://localhost:3000/forms/email-contact.json';

const sheet = {
  ':type': 'sheet',
  total: 6,
  offset: 0,
  limit: 6,
  data: [
    {
      Name: 'fullName', Type: 'text', Label: 'Full Name', Mandatory: 'x',
    },
    {
      Name: 'subject', Type: 'select', Label: 'Subject', Options: 'general,sales', OptionNames: 'General Enquiry,Sales',
    },
    {
      Name: 'preferredContact', Type: 'radio-group', Label: 'Preferred Contact Method', Options: 'email,phone', OptionNames: 'Email,Phone',
    },
    { Name: 'message', Type: 'textarea', Label: 'Message' },
    { Name: 'consent', Type: 'checkbox', Label: 'I agree to be contacted' },
    {
      Name: 'send', Type: 'submit', Label: 'Send Message', Value: 'Thanks, we got it!',
    },
  ],
};

function createBlock(rows) {
  global.fetch.mockData = { [formPath]: sheet };
  const block = document.createElement('div');
  block.className = 'form';
  block.innerHTML = [`<a href="${formPath}">${formPath}</a>`, ...rows]
    .map((cell) => `<div><div>${cell}</div></div>`).join('');
  document.body.replaceChildren(block);
  return block;
}

function fill(form) {
  form.querySelector('[name="fullName"]').value = 'Jane Doe';
  form.querySelector('select[name="subject"]').value = 'sales';
  form.querySelector('input[type="radio"][value="phone"]').checked = true;
  form.querySelector('textarea[name="message"]').value = 'Hello there';
  form.querySelector('input[type="checkbox"]').checked = true;
}

describe('Document-based form "Send to" email submit', () => {
  let openStub;
  let fetchSpy;

  beforeEach(() => {
    resetIds();
    document.title = 'Contact Us';
    window.open = () => null;
    openStub = Sinon.stub(window, 'open');
    fetchSpy = Sinon.spy(global, 'fetch');
  });

  afterEach(() => {
    openStub.restore();
    fetchSpy.restore();
  });

  describe('Standard behavior', () => {
    it('should remove the "Send to" row from the block', async () => {
      const block = createBlock(['Send to: team@example.com']);
      await decorate(block);
      assert.equal(block.dataset.sendTo, 'team@example.com');
      assert.equal(block.textContent.includes('Send to'), false, 'Send to row is still shown');
      assert.ok(block.querySelector('form'), 'form is not rendered');
    });

    it('should open the email app with labels and option text, then thank the visitor', async () => {
      const block = createBlock(['Send to: <a href="mailto:team@example.com">team@example.com</a>']);
      await decorate(block);
      const form = block.querySelector('form');
      fill(form);
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      await new Promise((r) => { setTimeout(r, 50); });

      assert.equal(openStub.callCount, 1, 'email app was not opened');
      const [url, target] = openStub.firstCall.args;
      assert.equal(target, '_self');
      assert.ok(url.startsWith('mailto:team@example.com?'), url);
      const params = new URLSearchParams(url.split('?')[1]);
      assert.equal(params.get('subject'), 'Contact Us: Sales');
      const body = params.get('body');
      ['Full Name: Jane Doe', 'Subject: Sales', 'Preferred Contact Method: Phone',
        'Message:\nHello there', 'I agree to be contacted: Yes'].forEach((line) => {
        assert.ok(body.includes(line), `body is missing "${line}":\n${body}`);
      });
      assert.equal(fetchSpy.getCalls().some((c) => String(c.args[0]).includes('forms.adobe.com')), false, 'answers were posted to the submission service');
      assert.equal(block.querySelector('.form-message.success-message')?.textContent, 'Thanks, we got it!');
    });
  });

  describe('Edge cases', () => {
    it('should not open the email app when a required field is empty', async () => {
      const block = createBlock(['Send to: team@example.com']);
      await decorate(block);
      const form = block.querySelector('form');
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      await new Promise((r) => { setTimeout(r, 50); });
      assert.equal(openStub.callCount, 0);
    });

    it('should ignore a "Send to" row without a valid email address', async () => {
      const block = createBlock(['Send to: not-an-email']);
      await decorate(block);
      assert.equal(block.dataset.sendTo, undefined);
    });
  });
});
