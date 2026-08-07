import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';

// Floating-label form controls for a cleaner, more modern look than a bare
// label + input. The placeholder is a single space so the CSS :placeholder-shown
// trick can tell "empty" from "filled".

export function TextField({
  label,
  ...props
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="ff">
      <input className="ff__input" placeholder=" " {...props} />
      <span className="ff__label">{label}</span>
    </label>
  );
}

export function SelectField({
  label,
  children,
  ...props
}: { label: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="ff ff--select">
      <select className="ff__input" {...props}>
        {children}
      </select>
      <span className="ff__label ff__label--static">{label}</span>
    </label>
  );
}

export function TextAreaField({
  label,
  ...props
}: { label: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="ff">
      <textarea className="ff__input" placeholder=" " {...props} />
      <span className="ff__label">{label}</span>
    </label>
  );
}
