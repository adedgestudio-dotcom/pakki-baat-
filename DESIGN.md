# 🎨 Pakki Baat Design System

## Brand Identity

### Logo & Icons
- **Main Logo**: Leaf icon representing growth and organic business relationships
- **Colors**: Warm teal gradient (#2d7667 to #1f5449) with coral accent (#ff7556)
- **Symbol**: The leaf represents "pakki" (firm/confirmed) commitments that grow over time

### Color Palette

```css
--cream-bg: #f5f1e8      /* Warm background */
--teal-primary: #2d7667   /* Primary brand color */
--teal-dark: #1f5449      /* Darker variant */
--coral-accent: #ff7556   /* Accent for highlights */
--text-dark: #2b3834      /* Main text */
--text-muted: #6b7570     /* Secondary text */
--border-light: #e8e3d8   /* Borders and dividers */
```

### Typography

- **Headings**: Georgia, Cambria (serif) - Warm, approachable
- **Body**: System fonts stack for best performance
- **Weights**: 400 (regular), 600 (semibold), 700 (bold)

## Design Principles

### 1. Warmth & Approachability
- Cream background instead of stark white
- Soft shadows and rounded corners
- Friendly, conversational copy

### 2. Clarity & Trust
- Clear visual hierarchy
- Ample whitespace
- Consistent spacing (8px grid)

### 3. Delight in Details
- Subtle animations on interactions
- Smooth transitions (200ms ease)
- Hover states on all interactive elements

### 4. Mobile-First
- Touch-friendly targets (min 44px)
- Responsive breakpoints: 560px, 800px, 1150px, 1500px
- Bottom navigation on mobile

## Component Styles

### Buttons

**Primary Button**
- Background: Teal gradient
- Shadow: 0 2px 8px rgba(45, 118, 103, 0.2)
- Hover: Lift effect (-1px translate)

**Secondary/Outline Button**
- Border: 1px solid #d8dfd0
- Hover: Border changes to teal

**Icon Buttons**
- Circular 40-42px
- Subtle hover background
- Scale animation on interaction

### Cards & Panels

- Border radius: 12-18px
- Subtle shadow: 0 2px 8px rgba(0, 0, 0, 0.04)
- Hover shadow: 0 4px 16px rgba(0, 0, 0, 0.06)
- Border: 1px solid var(--line)

### Input Fields

- Border radius: 10px
- Focus: Teal border with shadow ring
- Min height: 44px for accessibility

## Iconography

**Leaf Icon Usage**
- Logo
- Brand mark in navigation
- Loading states
- Success indicators

**Other Icons**
- Feather-style line icons
- 1.7px stroke width
- Rounded caps and joins

## Animation Guidelines

### Timing
- **Fast**: 150ms - Color changes
- **Standard**: 200ms - Most interactions
- **Slow**: 300ms - Complex transitions

### Easing
- **ease-in-out**: Default
- **ease-out**: Entrances
- **ease-in**: Exits

### Types
- Hover states: scale(1.05) or translateY(-2px)
- Active states: scale(0.95)
- Slide animations: translateY or translateX
- Loading: Shimmer gradient

## Accessibility

### Focus States
- 3px outline with brand color
- 2px offset for visibility
- Never remove focus indicators

### Color Contrast
- Text on cream: AAA compliance
- White text on teal: AA compliance
- Icons: Minimum 3:1 ratio

### Touch Targets
- Minimum 44x44px
- Adequate spacing between interactive elements

## Responsive Behavior

### Mobile (<800px)
- Hide sidebar, show bottom nav
- Stack columns
- Larger touch targets
- Simplified layouts

### Tablet (800-1150px)
- Narrower sidebar (205px)
- 2-column layouts
- Hide helper text where appropriate

### Desktop (>1150px)
- Full sidebar (242px)
- Multi-column layouts
- Hover states enabled
- Additional context panels

## Usage Examples

### Creating a New Card
```css
.my-card {
  background: white;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  transition: all 0.2s ease;
}

.my-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
  transform: translateY(-2px);
}
```

### Adding a Button
```css
.custom-button {
  background: var(--teal);
  color: white;
  border-radius: 10px;
  padding: 12px 18px;
  box-shadow: 0 2px 8px rgba(45, 118, 103, 0.2);
  transition: all 0.2s ease;
}

.custom-button:hover {
  background: #247059;
  transform: translateY(-1px);
}
```

---

**Design Philosophy**: "A little less remembering. A little more doing what you love."

Every design decision should support small business owners in managing their commitments with warmth, clarity, and ease.
