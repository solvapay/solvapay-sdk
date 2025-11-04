# Step 4: Styling and Components

This guide covers setting up a modern UI component library with Tailwind CSS.

## Overview

We'll create:
1. Tailwind CSS configuration
2. Global styles
3. UI component library (Button, Input, Card, Form, Badge)
4. Common styling patterns

## Step 1: Configure Tailwind CSS

Update `tailwind.config.ts`:

```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        slate: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
        emerald: {
          100: '#d1fae5',
          200: '#a7f3d0',
          700: '#047857',
        },
        blue: {
          100: '#dbeafe',
          200: '#bfdbfe',
          400: '#60a5fa',
          700: '#1d4ed8',
        },
        purple: {
          100: '#f3e8ff',
          200: '#e9d5ff',
          400: '#a78bfa',
          700: '#7c3aed',
        },
        red: {
          100: '#fee2e2',
          400: '#f87171',
          700: '#b91c1c',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fade-in 0.5s ease-out forwards',
        'slide-up': 'slide-up 0.6s ease-out forwards',
        'slide-down': 'slide-down 0.6s ease-out forwards',
        'scale-in': 'scale-in 0.4s ease-out forwards',
      },
      keyframes: {
        'fade-in': {
          'from': { opacity: '0' },
          'to': { opacity: '1' },
        },
        'slide-up': {
          'from': { opacity: '0', transform: 'translateY(20px)' },
          'to': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          'from': { opacity: '0', transform: 'translateY(-20px)' },
          'to': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          'from': { opacity: '0', transform: 'scale(0.9)' },
          'to': { opacity: '1', transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
```

## Step 2: Update Global Styles

Update `app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Minimal styling */
html, body {
  height: 100%;
  margin: 0;
  padding: 0;
}

body {
  background-color: white;
  color: #0f172a;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
}

/* Smooth transitions */
* {
  transition-property: color, background-color, border-color;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}

/* Focus states */
button:focus-visible,
input:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}
```

## Step 3: Create Button Component

Create `app/components/ui/Button.tsx`:

```typescript
import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'icon';
  children: React.ReactNode;
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  children,
  className = '',
  isLoading = false,
  disabled,
  ...props
}) => {
  const baseClasses = 'font-medium transition-all duration-200 focus:outline-none focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2';
  
  const variantClasses = {
    primary: 'px-4 py-2.5 text-sm text-white bg-slate-900 rounded-full hover:bg-slate-800 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed',
    secondary: 'px-4 py-2 text-xs text-slate-600 bg-transparent rounded-full hover:text-slate-900 hover:bg-slate-50',
    icon: 'p-1.5 text-slate-400 bg-transparent rounded-lg hover:text-slate-700 hover:bg-slate-50',
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${className} ${isLoading ? 'flex items-center justify-center' : ''}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <svg className="animate-spin mr-3 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Processing...</span>
        </>
      ) : (
        children
      )}
    </button>
  );
};
```

## Step 4: Create Input Component

Create `app/components/ui/Input.tsx`:

```typescript
import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  icon,
  className = '',
  ...props
}) => {
  const inputClasses = `block w-full px-3 py-2 bg-white border rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 focus:border-slate-300 transition-colors ${
    error ? 'border-red-400 focus:ring-red-200' : 'border-slate-200/60'
  } ${icon ? 'pr-12' : ''} ${className}`;

  return (
    <div>
      {label && (
        <label className="block text-xs font-medium text-slate-700 mb-1">
          {label}
        </label>
      )}
      <div className="relative">
        <input className={inputClasses} {...props} />
        {icon && (
          <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none">
            {icon}
          </div>
        )}
      </div>
      {error && (
        <p className="mt-1 text-xs text-red-700">{error}</p>
      )}
    </div>
  );
};
```

## Step 5: Create Card Component

Create `app/components/ui/Card.tsx`:

```typescript
import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'glass';
  style?: React.CSSProperties;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  variant = 'default',
  style,
}) => {
  const baseClasses = 'rounded-2xl shadow-xl border border-slate-200/60';
  
  const variantClasses = {
    default: 'bg-white',
    glass: 'bg-white/95 backdrop-blur-lg',
  };

  return (
    <div className={`${baseClasses} ${variantClasses[variant]} ${className}`} style={style}>
      {children}
    </div>
  );
};
```

## Step 6: Create Form Component

Create `app/components/ui/Form.tsx`:

```typescript
import React from 'react';

interface FormProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
  className?: string;
}

export const Form: React.FC<FormProps> = ({
  children,
  title,
  description,
  className = '',
}) => {
  return (
    <div className={`bg-white/80 backdrop-blur-sm rounded-xl shadow-sm border border-slate-200/60 p-5 ${className}`}>
      {title && (
        <h2 className="text-lg font-semibold text-slate-900 mb-1">{title}</h2>
      )}
      {description && (
        <p className="text-sm text-slate-600 mb-4">{description}</p>
      )}
      {children}
    </div>
  );
};
```

## Step 7: Create Badge Component

Create `app/components/ui/Badge.tsx`:

```typescript
import React from 'react';

type BadgeVariant = 'premium' | 'free' | 'credits' | 'daypass';

interface BadgeProps {
  children: React.ReactNode;
  variant: BadgeVariant;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant,
  className = '',
}) => {
  const variantClasses = {
    premium: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    free: 'bg-slate-100 text-slate-600 border-slate-200',
    credits: 'bg-blue-100 text-blue-700 border-blue-200',
    daypass: 'bg-purple-100 text-purple-700 border-purple-200',
  };

  return (
    <span
      className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
};
```

## Step 8: Create FormField Component (Optional)

Create `app/components/ui/FormField.tsx`:

```typescript
import React from 'react';
import { Input } from './Input';

interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  icon?: React.ReactNode;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  error,
  icon,
  className = '',
  ...props
}) => {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">
        {label}
      </label>
      <Input
        label="" // Don't duplicate label
        error={error}
        icon={icon}
        className={className}
        {...props}
      />
    </div>
  );
};
```

## Common Patterns

### Error Messages

```typescript
{error && (
  <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
    {error}
  </div>
)}
```

### Success Messages

```typescript
<div className="text-sm text-blue-600 bg-blue-50 border border-blue-200 rounded-lg p-3">
  Success message
</div>
```

### Loading States

```typescript
// Skeleton loader
const Skeleton = ({ className = '' }: { className?: string }) => (
  <div className={`animate-pulse bg-slate-200 rounded ${className}`} />
);

<Skeleton className="h-5 w-48" />
```

### Divider with Text

```typescript
<div className="relative">
  <div className="absolute inset-0 flex items-center">
    <div className="w-full border-t border-slate-200"></div>
  </div>
  <div className="relative flex justify-center text-sm">
    <span className="px-2 bg-white text-slate-500">Or continue with email</span>
  </div>
</div>
```

## Design Principles

1. **Color Palette**: Primarily uses slate grays with accent colors (emerald, blue, purple, red) for status indicators
2. **Border Radius**: 
   - Small elements: `rounded-lg` (8px)
   - Medium elements: `rounded-xl` (12px)
   - Large elements: `rounded-2xl` (16px)
   - Buttons: `rounded-full` (pill shape)
3. **Shadows**: Subtle shadows (`shadow-sm`, `shadow-xl`) for depth
4. **Transitions**: Smooth 150ms transitions for interactive elements
5. **Spacing**: Consistent spacing using Tailwind's scale (4px base unit)
6. **Typography**: System font stack with medium weight for headings, regular for body text
7. **Focus States**: Blue outline (`#3b82f6`) with 2px width and offset

## Component File Structure

Your component structure should now be:

```
app/
  components/
    ui/
      Button.tsx
      Card.tsx
      Badge.tsx
      Input.tsx
      Form.tsx
      FormField.tsx
    Auth.tsx
```

## Usage Examples

### Button

```typescript
<Button variant="primary" onClick={handleClick}>
  Click me
</Button>

<Button variant="secondary" isLoading={isLoading}>
  Submit
</Button>
```

### Input

```typescript
<Input
  type="email"
  label="Email"
  placeholder="you@example.com"
  value={email}
  onChange={(e) => setEmail(e.target.value)}
/>

<Input
  type="password"
  label="Password"
  error="Password is required"
/>
```

### Card

```typescript
<Card>
  <h2>Card Title</h2>
  <p>Card content</p>
</Card>

<Card variant="glass">
  Glass morphism effect
</Card>
```

### Badge

```typescript
<Badge variant="premium">Premium</Badge>
<Badge variant="free">Free</Badge>
```

## Verification

Test your components:

1. **Check that components render:**
   - Visit http://localhost:3000
   - Auth form should display with styled inputs and buttons
   - After sign-in, home page should display styled content

2. **Test interactions:**
   - Buttons should have hover states
   - Inputs should have focus states
   - Loading states should display spinner

3. **Verify styling:**
   - Colors match design system
   - Spacing is consistent
   - Transitions are smooth

## Troubleshooting

### Tailwind styles not applying
- Verify `tailwind.config.ts` includes all content paths
- Ensure `globals.css` is imported in `layout.tsx`
- Check that PostCSS is configured correctly
- Restart the dev server after configuration changes

### Components not rendering
- Check import paths are correct
- Verify components are exported correctly
- Check browser console for errors

## Next Steps

Now that styling is set up, proceed to:
- **[Step 5: Complete Example](./05-complete-example.md)** - Full working implementation with all features

