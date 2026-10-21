import type { PreviewNode, ScreenPreview } from '@appflow/model';
import { describe, expect, it } from 'vitest';
import { ReactNativePreviewer } from './reactNative';

/** Draws `component` from in-memory project files. */
async function draw(files: Record<string, string>, file: string, component: string): Promise<ScreenPreview> {
  const source = { readText: async (p: string) => files[p] ?? null, exists: async (p: string) => p in files };
  const previewer = await ReactNativePreviewer.open(source, '');
  try {
    return await previewer.preview({ screenId: `react-native:${component}`, file, component });
  } finally {
    previewer.dispose();
  }
}

const all = (n: PreviewNode): PreviewNode[] => [n, ...(n.children ?? []).flatMap(all)];
const find = (p: ScreenPreview, f: (n: PreviewNode) => boolean) => all(p.root).filter(f);
/** Text of a `text` node: literal runs as they are, runtime data as `{expr}`. */
const textOf = (n: PreviewNode): string => (n.type === 'raw' ? (n.dynamic ? `{${n.text}}` : n.text!) : (n.children ?? []).map(textOf).join(''));
const texts = (p: ScreenPreview) => find(p, (n) => n.type === 'text').filter((t, _, list) => !list.some((o) => o !== t && o.children?.includes(t))).map(textOf);

const PACKAGE = JSON.stringify({ dependencies: { 'react-native': '0.74.0' } });

describe('React Native preview — styles', () => {
  it('works out StyleSheet, ScaledSheet, theme constants through an alias, arrays and conditions', async () => {
    const p = await draw(
      {
        'package.json': PACKAGE,
        'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
        'src/theme/index.ts': "export const Colors = { primary: '#830CFF', muted: '#999' };\nexport * from './spacing';",
        'src/theme/spacing.ts': 'export const Spacing = { md: 12 };',
        'src/Home.tsx': `
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { ScaledSheet } from 'react-native-size-matters';
import { Colors, Spacing } from '@/theme';

const active = false;
export default function Home() {
  return (
    <View style={[styles.box, active && styles.active, { padding: Spacing.md }]}>
      <Text style={[scaled.title, { color: Colors.primary }]}>Hello</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  box: { flex: 1, backgroundColor: '#fff', marginTop: Platform.select({ ios: 20, android: 0 }) },
  active: { backgroundColor: 'red' },
});
const scaled = ScaledSheet.create({ title: { fontSize: '14@s', marginBottom: '10@vs' } });
`,
      },
      'src/Home.tsx',
      'Home',
    );
    const box = find(p, (n) => n.type === 'view' && n.component === 'View')[0]!;
    expect(box.style).toEqual({ flex: 1, backgroundColor: '#fff', marginTop: 20, padding: 12 });
    const title = find(p, (n) => n.type === 'text')[0]!;
    expect(title.style).toMatchObject({ color: '#830CFF', fontSize: 15 });
    expect(Number(title.style!.marginBottom)).toBeCloseTo((812 / 680) * 10);
    expect(texts(p)).toEqual(['Hello']);
    expect(p.notes).toEqual([]);
  });
});

describe('React Native preview — components and data', () => {
  const files: Record<string, string> = {
    'package.json': PACKAGE,
    'src/components/index.ts': "export { default as AppText } from './AppText';\nexport * from './Card';",
    'src/components/AppText.tsx': `
import React, { memo } from 'react';
import { Text } from 'react-native';
const AppText = ({ children, color = '#353535', size = 14, style }: any) => <Text style={[{ color, fontSize: size }, style]}>{children}</Text>;
export default memo(AppText);
`,
    'src/components/Card.tsx': `
import React, { forwardRef } from 'react';
import { View } from 'react-native';
export const Card = forwardRef(({ children, row, ...rest }: any, ref) => <View {...rest} style={[{ borderRadius: 8 }, row && { flexDirection: 'row' }]}>{children}</View>);
`,
    'src/assets/logo@2x.png': '',
    'src/Feed.tsx': `
import React, { useState } from 'react';
import { FlatList, Image, ActivityIndicator, TextInput, View } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { Controller } from 'react-hook-form';
import { AppText, Card } from './components';
import useFeed from './useFeed';

export default function Feed({ route }: any) {
  const { items, loading, user } = useFeed(route.params.id);
  const [query, setQuery] = useState('');
  if (loading) return <ActivityIndicator />;
  return (
    <View>
      <Image source={require('./assets/logo.png')} style={{ width: 40, height: 40 }} />
      <AppText size={18}>{\`Hi \${user.name}!\\nWelcome\`}</AppText>
      <TextInput value={query} placeholder="Search" />
      <Controller name="email" render={({ field }) => <TextInput value={field.value} placeholder="Email" />} />
      <Icon name="heart" size={20} color="red" />
      {items.length === 0 ? <AppText>Empty</AppText> : (
        <FlatList data={items} renderItem={({ item }) => <Card row><AppText>{item.title}</AppText></Card>} />
      )}
    </View>
  );
}
`,
  };

  it('opens project components through barrels, memo and forwardRef, with default props and children', async () => {
    const p = await draw(files, 'src/Feed.tsx', 'Feed');
    const greeting = find(p, (n) => n.type === 'text' && textOf(n).startsWith('Hi'))[0]!;
    expect(greeting.style).toEqual({ color: '#353535', fontSize: 18 });
    // Template literal: literal text, the runtime value as its expression, escapes decoded.
    expect(textOf(greeting)).toBe('Hi {user.name}!\nWelcome');
  });

  it('draws the main content of data-driven screens: no early return, the richer branch, sample list rows', async () => {
    const p = await draw(files, 'src/Feed.tsx', 'Feed');
    expect(find(p, (n) => n.type === 'spinner')).toEqual([]);
    expect(texts(p)).not.toContain('Empty');
    const list = find(p, (n) => n.component === 'FlatList')[0]!;
    expect(list.type).toBe('scroll');
    expect(list.children!.map((c) => [c.style?.flexDirection, textOf(c)])).toEqual([
      ['row', '{item.title}'],
      ['row', '{item.title}'],
      ['row', '{item.title}'],
    ]);
  });

  it('resolves images, inputs, render props and vector icons', async () => {
    const p = await draw(files, 'src/Feed.tsx', 'Feed');
    expect(find(p, (n) => n.type === 'image')[0]!.image).toEqual({ assetPath: 'src/assets/logo@2x.png', resizeMode: undefined, density: 2 });
    expect(find(p, (n) => n.type === 'input').map((n) => [n.value, n.placeholder])).toEqual([
      ['', 'Search'],
      [undefined, 'Email'],
    ]);
    expect(find(p, (n) => n.type === 'icon')[0]!.icon).toEqual({ set: 'Ionicons', name: 'heart', size: 20, color: 'red' });
    // The glyph map is not installed in this project.
    expect(p.notes).toEqual(['Icon Ionicons/heart was not found in node_modules.']);
  });

  it('records where each element is written', async () => {
    const p = await draw(files, 'src/Feed.tsx', 'Feed');
    expect(find(p, (n) => n.type === 'image')[0]!.location).toMatchObject({ fileId: 'src/Feed.tsx', line: 15 });
    expect(find(p, (n) => n.type === 'text')[0]!.location).toMatchObject({ fileId: 'src/components/AppText.tsx', line: 4 });
  });

  it('labels components it cannot draw and says why a screen could not be drawn', async () => {
    const p = await draw({ ...files, 'src/Map.tsx': "import MapView from 'react-native-maps';\nexport default () => <MapView style={{ height: 200 }} />;" }, 'src/Map.tsx', 'Map');
    expect(find(p, (n) => n.type === 'placeholder').map((n) => [n.text, n.style])).toEqual([['MapView', { height: 200 }]]);
    const missing = await draw(files, 'src/Nope.tsx', 'Nope');
    expect(missing.notes).toEqual(['src/Nope.tsx could not be read.']);
  });
});
