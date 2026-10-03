---
name: Precision Enterprise AI
colors:
  surface: '#f9f9ff'
  surface-dim: '#d1daf4'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f1f3ff'
  surface-container: '#e9edff'
  surface-container-high: '#e1e8ff'
  surface-container-highest: '#d9e2fc'
  on-surface: '#121b2e'
  on-surface-variant: '#464555'
  inverse-surface: '#273044'
  inverse-on-surface: '#edf0ff'
  outline: '#777587'
  outline-variant: '#c7c4d8'
  surface-tint: '#4d44e3'
  primary: '#3525cd'
  on-primary: '#ffffff'
  primary-container: '#4f46e5'
  on-primary-container: '#dad7ff'
  inverse-primary: '#c3c0ff'
  secondary: '#0058be'
  on-secondary: '#ffffff'
  secondary-container: '#2170e4'
  on-secondary-container: '#fefcff'
  tertiary: '#7e3000'
  on-tertiary: '#ffffff'
  tertiary-container: '#a44100'
  on-tertiary-container: '#ffd2be'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#0f0069'
  on-primary-fixed-variant: '#3323cc'
  secondary-fixed: '#d8e2ff'
  secondary-fixed-dim: '#adc6ff'
  on-secondary-fixed: '#001a42'
  on-secondary-fixed-variant: '#004395'
  tertiary-fixed: '#ffdbcc'
  tertiary-fixed-dim: '#ffb695'
  on-tertiary-fixed: '#351000'
  on-tertiary-fixed-variant: '#7b2f00'
  background: '#f9f9ff'
  on-background: '#121b2e'
  surface-variant: '#d9e2fc'
typography:
  headline-xl:
    fontFamily: Be Vietnam Pro
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Be Vietnam Pro
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.015em
  headline-lg:
    fontFamily: Be Vietnam Pro
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Be Vietnam Pro
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  title-md:
    fontFamily: Be Vietnam Pro
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.005em
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 16px
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.04em
  code-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1.75rem
  gutter-mobile: 1rem
  margin: 2rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.75rem
  space-xl: 2rem
---

## Brand & Style

This design system embodies a modern, disciplined corporate aesthetic engineered for enterprise AI administration and heavy data governance. It delivers absolute clarity, high operational velocity, and rigorous precision. 

### Visual Tenets
- **Crisp Structural Discipline:** Clean geometry with definitive visual hierarchy. Information density is prioritized without inducing cognitive clutter.
- **Architectural Clarity:** Strict avoidance of decorative distractions such as heavy frosted glass, high-diffusion colored halos, or muddy gradient fills. Crisp surface contrast and precise division lines establish immediate affordance.
- **Calculated Reliability:** High-contrast neutral typography balanced against an authoritative indigo primary accent, projecting algorithmic speed and operational stability.

## Colors

The color architecture is built for strict WCAG AA/AAA compliance against light enterprise surfaces.

### Core Swatches
- **Primary Brand:** `#4F46E5` (Indigo 600) — Primary interactive states, active indicators, and high-priority action affordance.
- **Primary Hover:** `#4338CA` (Indigo 700) — Hover state for primary interactive elements.
- **Primary Light:** `#EEF2FF` (Indigo 50) — Active item container backgrounds, selected navigation rows, and focus glows.
- **Secondary / Info:** `#3B82F6` (Blue 500) — Informational metrics, technical notifications, and secondary progress indicators.
- **Base Canvas (Background):** `#F7F8FC` — Low-glare, cool slate canvas providing distinct contrast under pure white surfaces.
- **Surface / Cards:** `#FFFFFF` — Elevated functional layers, data cards, modals, and toolbars.

### Neutrals & Text Hierarchy
- **Text Primary:** `#172033` — Dominant headings, primary labels, and high-priority data metrics.
- **Text Secondary:** `#64748B` (Slate 500) — Secondary labels, table column headers, and structural body text.
- **Text Muted:** `#94A3B8` (Slate 400) — Disabled content, placeholder text, and tertiary metadata.
- **Border Default:** `#E8EBF2` — Standard partition lines, data table row dividers, and container bounds.
- **Border Darker:** `#D9DFE9` — Interactive input borders, segmented control frames, and hover borders.

### Semantic Status
- **Success:** `#10B981` (Emerald 500) — Online nodes, successful inferences, positive telemetry.
- **Warning:** `#F59E0B` (Amber 500) — Resource limits approached, validation cautions.
- **Danger:** `#EF4444` (Rose 500) — System faults, error states, destructive triggers.

## Typography

The typographic stack pairs **Be Vietnam Pro** for structural headers with **Inter** for data grids, body prose, and system labels.

### Rules of Usage
- **Display & Headings:** Use Be Vietnam Pro (SemiBold to Bold) with negative letter-spacing for dashboard views, page titles, and modal headers.
- **Operational Data & Grids:** Inter serves all data displays, form controls, and code snippets. Numerical values in tables must utilize tabular lining (`font-feature-settings: 'tnum' 1`).
- **Section & Table Headers:** Subheaders and table header cells use `label-sm` with uppercase transformation and a loose `0.04em` tracking to preserve legibility when scanning dense datasets.

## Layout & Spacing

The layout is grounded on a rigid 8px system with strict shell constraints suited for enterprise management.

### Shell Dimensions
- **Sidebar Width:** Fixed `232px`, pinned left, collapsible to `64px` icon mode on compact displays.
- **Topbar Height:** Fixed `64px`, pinned top, bounding navigation, search, and admin user controls.
- **Main Canvas Margin:** `28px` to `32px` (`1.75rem` - `2rem`) margin around interior workspace surfaces on desktop viewports.

### Grid & Responsiveness
- **Desktop (≥ 1280px):** 12-column fluid grid, `28px` (`1.75rem`) gutter, fixed 232px sidebar offset.
- **Tablet (768px – 1279px):** 8-column layout, sidebar collapses automatically to a drawer or 64px icon bar, `20px` gutters.
- **Mobile (< 768px):** 4-column layout, stacked sections, topbar collapses to minimal 56px variant, `16px` margins and gutters.

## Elevation & Depth

Visual hierarchy uses crisp boundary lines reinforced by razor-thin, minimal ambient shadows. No high-radius blurs or skeuomorphic gradients are permitted.

### Depth Scale
- **Base Level (Canvas):** Tone `#F7F8FC`. Flat, zero elevation.
- **Level 1 (Card & Containers):** Background `#FFFFFF`, border `1px solid #E8EBF2`, shadow `0 1px 3px 0 rgba(0, 0, 0, 0.05)`.
- **Level 2 (Interactive Hover & Dropdowns):** Background `#FFFFFF`, border `1px solid #D9DFE9`, shadow `0 4px 6px -1px rgba(0, 0, 0, 0.07), 0 2px 4px -2px rgba(0, 0, 0, 0.05)`.
- **Level 3 (Modals & Command Palettes):** Background `#FFFFFF`, border `1px solid #D9DFE9`, shadow `0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -4px rgba(0, 0, 0, 0.04)`.

## Shapes

The design system maintains a clean geometric discipline balancing ergonomics with structural sharpness.

### Corner Radius System
- **Compact Elements (Chips, Inputs, Buttons):** `6px` to `8px` (`0.375rem` - `0.5rem`).
- **Surfaces & Cards (`rounded-lg`):** `8px` to `12px` (`0.5rem` - `0.75rem`), with `10px` standard for dashboard panels.
- **Modals & Drawers (`rounded-xl`):** `12px` (`0.75rem`).
- **Indicators / Badges:** Full pill (`9999px`) reserved strictly for status pills and counter tags.

## Components

Components follow Ant Design precision with Tailwind CSS utility constraints and Lucide 16px/20px linear icons.

### Buttons
- **Primary:** Background `#4F46E5`, color `#FFFFFF`, border `1px solid #4F46E5`, height `36px` (medium), horizontal padding `14px`, border-radius `8px`. Hover: `#4338CA`. Active focus: 2px ring `#EEF2FF` with `#4F46E5` outline.
- **Secondary / Default:** Background `#FFFFFF`, color `#172033`, border `1px solid #D9DFE9`, hover background `#F7F8FC`.
- **Ghost / Tertiary:** Transparent background, color `#64748B`, hover background `#EEF2FF`, hover color `#4F46E5`.

### Input Fields & Controls
- **Text Inputs:** Height `36px`, background `#FFFFFF`, border `1px solid #D9DFE9`, border-radius `6px`, padding `0 12px`, text color `#172033`. Placeholder: `#94A3B8`. Focused: border `#4F46E5`, shadow `0 0 0 3px rgba(79, 70, 229, 0.12)`.
- **Checkboxes & Radios:** `16px × 16px`, border `1.5px solid #D9DFE9`, border-radius `4px` (checkbox) or `50%` (radio). Checked state: fill `#4F46E5`, icon white.

### Data Cards & Panels
- **Structure:** Background `#FFFFFF`, border `1px solid #E8EBF2`, border-radius `10px`, shadow `0 1px 3px rgba(0,0,0,0.05)`.
- **Padding:** Header has `16px 20px` border-bottom `1px solid #E8EBF2`. Body contains `20px` padding.

### Chips & Status Badges
- **Format:** Height `22px`, font size `11px`, font weight `600`, border-radius `9999px`, inline-flex alignment.
- **Tone Pairing:**
  - Success: Background `#ECFDF5`, text `#065F46`, dot `#10B981`.
  - Warning: Background `#FFFBEB`, text `#92400E`, dot `#F59E0B`.
  - Danger: Background `#FEF2F2`, text `#991B1B`, dot `#EF4444`.
  - Info: Background `#EFF6FF`, text `#1E40AF`, dot `#3B82F6`.

### Data Tables
- Row height `44px` compact, `52px` standard. Header background `#F7F8FC`, text `#64748B`, uppercase `11px`, border-bottom `1px solid #D9DFE9`. Row lines bordered with `#E8EBF2`. Hover row fill `#F8FAFC`.