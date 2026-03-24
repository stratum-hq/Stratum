import React, { useId } from "react";

export interface TenantBranding {
  primaryColor?: string;
  logoUrl?: string;
  companyName?: string;
  customCss?: string;
}

export interface TenantThemeProviderProps {
  branding: TenantBranding;
  children: React.ReactNode;
  className?: string;
}

export function TenantThemeProvider({
  branding,
  children,
  className,
}: TenantThemeProviderProps) {
  const scopeId = useId().replace(/:/g, "");
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

  return (
    <div
      className={`stratum-tenant-theme-provider ${className || ""}`}
      style={cssVars}
      {...{ [dataAttr]: "" }}
    >
      {branding.customCss && (
        <style>{`${scopeSelector} { ${branding.customCss} }`}</style>
      )}
      {children}
    </div>
  );
}
