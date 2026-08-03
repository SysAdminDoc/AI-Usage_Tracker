// Small DOM construction helpers. UI code uses textContent and validated
// attributes for all dynamic values; no caller needs to assemble HTML strings.

const FORBIDDEN_ATTRIBUTE = /^on/i;

export function createElement(tagName, { className = '', text = null, attrs = {}, children = [] } = {}) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text != null) element.textContent = String(text);
  setSafeAttributes(element, attrs);
  appendChildren(element, children);
  return element;
}

export function createSvgElement(tagName, { attrs = {}, children = [] } = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tagName);
  setSafeAttributes(element, attrs);
  appendChildren(element, children);
  return element;
}

export function setSafeAttribute(element, name, value) {
  if (FORBIDDEN_ATTRIBUTE.test(String(name))) {
    throw new Error(`Unsafe event attribute rejected: ${name}`);
  }
  if (value == null) element.removeAttribute(name);
  else element.setAttribute(name, String(value));
  return element;
}

export function setSafeAttributes(element, attrs = {}) {
  for (const [name, value] of Object.entries(attrs)) setSafeAttribute(element, name, value);
  return element;
}

export function appendChildren(parent, children = []) {
  for (const child of children.flat()) {
    if (child == null) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return parent;
}

export function clearChildren(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
  return element;
}

// Static-only compatibility escape hatch for reviewed SVG/icon markup. It
// rejects interpolation and common executable sinks so dynamic state cannot
// accidentally enter a template later.
export function setStaticMarkup(element, markup) {
  if (typeof markup !== 'string' || /\$\{|<script\b|\son\w+\s*=|javascript:/i.test(markup)) {
    throw new Error('Only reviewed static markup may use setStaticMarkup');
  }
  element.innerHTML = markup;
  return element;
}
