import re

css_path = r'c:\Users\parne\OneDrive\Desktop\UniversalAllergen\server\style.css'

with open(css_path, 'r', encoding='utf-8') as f:
    css = f.read()

# 1. Soften UI with much rounder corners
css = css.replace('--radius-xl: 32px;', '--radius-xl: 52px;')
css = css.replace('--radius-lg: 24px;', '--radius-lg: 42px;')
css = css.replace('--radius-md: 18px;', '--radius-md: 32px;')
css = css.replace('--radius-sm: 14px;', '--radius-sm: 24px;')

# Update specific rounding that was hardcoded or missed
css = css.replace('border-radius: 999px;', 'border-radius: 999px;') # Keep pills
css = css.replace('border-radius: 28px;', 'border-radius: 42px;')
css = css.replace('border-radius: 36px;', 'border-radius: 56px;')
css = css.replace('border-radius: 22px;', 'border-radius: 36px;')
css = css.replace('border-radius: 34px;', 'border-radius: 52px;')
css = css.replace('border-radius: 30px;', 'border-radius: 46px;')
css = css.replace('border-radius: 60px;', 'border-radius: 999px;') # Traffic light stack more round

# 2. Revert Heading Font to 'DM Sans'
# Audit all font-family declarations
css = css.replace('"Space Grotesk", "DM Sans"', '"DM Sans", "Inter"')
css = css.replace('"Space Grotesk"', '"DM Sans"')

# Update specific font-weight to be bolder/rounder for headings
heading_pattern = r'\.sidebar h2,\s*\.hero-panel h1,\s*\.panel h2,\s*\.panel h3,\s*\.topbar-panel h3,\s*\.window-title\s*\{[^}]*\}'
heading_replacement = '''.sidebar h2,
.hero-panel h1,
.panel h2,
.panel h3,
.topbar-panel h3,
.window-title {
    margin: 0;
    font-family: "DM Sans", "DM Sans", sans-serif;
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: -0.05em;
}'''
css = re.sub(heading_pattern, heading_replacement, css)

# Make sure Hero panel <h1> looks extra round and bold
hero_pattern = r'\.hero-panel h1\s*\{[^}]*\}'
hero_replacement = '''.hero-panel h1 {
    position: relative;
    z-index: 1;
    max-width: 11ch;
    font-size: clamp(40px, 4vw, 68px);
    color: #ffffff;
    font-family: "DM Sans", sans-serif !important;
    font-weight: 800;
    letter-spacing: -0.06em;
}'''
css = re.sub(hero_pattern, hero_replacement, css)

with open(css_path, 'w', encoding='utf-8') as f:
    f.write(css)

print('UI Softening & Font Reversion Complete via Script')
