import React, { useId } from "react";

export interface TenantBranding {
  primaryColor?: string;
  logoUrl?: string;
  companyName?: string;
  /**
   * CSS declarations applied to this provider's subtree, for example
   * `"color: red; font-weight: 600;"`. Only plain declarations are accepted:
   * a value containing braces, `@`, `<`, backslashes, quotes or `url(` is
   * ignored, so it cannot add rules outside the subtree or load resources.
   */
  customCss?: string;
}

export interface TenantThemeProviderProps {
  branding: TenantBranding;
  children: React.ReactNode;
  className?: string;
}

/**
 * Characters and functions that would let customCss leave its declaration
 * block (braces, at-rules, a closing </style>), smuggle those in through CSS
 * escapes or strings, or fetch from another origin (url(), image-set() and
 * friends all need url() or a quoted string).
 */
const UNSAFE_CUSTOM_CSS = /[{}@<\\"']|url\s*\(/i;

function safeCustomCss(customCss: string | undefined): string | null {
  if (!customCss) return null;
  if (UNSAFE_CUSTOM_CSS.test(customCss)) {
    console.warn(
      "[stratum] TenantThemeProvider ignored customCss: only plain CSS declarations are allowed " +
        "(no braces, at-rules, backslashes, quotes or url()).",
    );
    return null;
  }
  return customCss;
}

export function TenantThemeProvider({
  branding,
  children,
  className,
}: TenantThemeProviderProps) {
  const scopeId = useId().replace(/:/g, "").toLowerCase();
  const dataAttr = `data-stratum-theme-${scopeId}`;

  const cssVars: React.CSSProperties & Record<string, string> = {};
  if (branding.primaryColor) {
    cssVars["--color-primary"] = branding.primaryColor;
  }
  if (branding.logoUrl) {
    cssVars["--stratum-logo-url"] = `url(${branding.logoUrl})`;
  }
  if (branding.companyName) {
    cssVars["--stratum-company-name"] = `"${branding.companyName}"`;
  }

  const scopeSelector = `[${dataAttr}]`;
  const customCss = safeCustomCss(branding.customCss);

  return (
    <div
      className={`stratum-tenant-theme-provider ${className || ""}`}
      style={cssVars}
      {...{ [dataAttr]: "" }}
    >
      {customCss && (
        <style>{`${scopeSelector} { ${customCss} }`}</style>
      )}
      {children}
    </div>
  );
}
