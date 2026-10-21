import type { PreviewNode, ScreenPreview } from '@appflow/model';
import { describe, expect, it } from 'vitest';
import { AndroidPreviewer } from '.';
import { androidHex } from './resources';

const RES = 'app/src/main/res';
const JAVA = 'app/src/main/java/com/demo';

const files: Record<string, string> = {
  'app/src/main/AndroidManifest.xml': `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:theme="@style/AppTheme" android:label="@string/app_name">
    <activity android:name=".HomeActivity" />
    <activity android:name=".PlayerActivity" android:theme="@style/Theme.AppCompat.NoActionBar" />
  </application></manifest>`,
  [`${RES}/values/colors.xml`]: '<resources><color name="purple">#8E33FF</color><color name="half_black">#80000000</color></resources>',
  [`${RES}/values/dimens.xml`]: '<resources><dimen name="gap">12dp</dimen></resources>',
  [`${RES}/values/strings.xml`]: '<resources><string name="app_name">Demo</string><string name="start">スタート</string></resources>',
  [`${RES}/values/styles.xml`]: `<resources>
    <style name="AppTheme" parent="Theme.AppCompat.Light.NoActionBar"><item name="colorPrimary">@color/purple</item></style>
    <style name="Title"><item name="android:textSize">20sp</item><item name="android:textStyle">bold</item></style>
  </resources>`,
  [`${RES}/drawable/bg_pill.xml`]: '<shape xmlns:android="http://schemas.android.com/apk/res/android"><solid android:color="@color/purple"/><corners android:radius="24dp"/><stroke android:width="1dp" android:color="#FFFFFF" android:dashWidth="2dp"/></shape>',
  [`${RES}/drawable/ic_close.xml`]: '<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24"><path android:fillColor="#FF000000" android:pathData="M6,6L18,18"/></vector>',
  [`${RES}/drawable-xxhdpi/logo.png`]: '',
  [`${RES}/drawable-mdpi/logo.png`]: '',
  [`${RES}/layout/activity_home.xml`]: `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" xmlns:app="http://schemas.android.com/apk/res-auto" xmlns:tools="http://schemas.android.com/tools"
    android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical" android:gravity="center_horizontal" android:padding="@dimen/gap">
    <ImageView android:layout_width="wrap_content" android:layout_height="wrap_content" android:src="@drawable/logo"/>
    <TextView android:id="@+id/title" style="@style/Title" android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="@string/app_name"/>
    <TextView android:id="@+id/subtitle" android:layout_width="match_parent" android:layout_height="0dp" android:layout_weight="1" tools:text="Sample subtitle"/>
    <TextView android:id="@+id/name" android:layout_width="wrap_content" android:layout_height="wrap_content" android:visibility="gone"/>
    <include layout="@layout/part_footer" android:layout_marginTop="8dp"/>
  </LinearLayout>`,
  [`${RES}/layout/part_footer.xml`]: `<Button xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="48dp"
    android:background="@drawable/bg_pill" android:text="@string/start" android:textColor="#FFF"/>`,
  [`${RES}/layout/activity_player.xml`]: `<androidx.constraintlayout.widget.ConstraintLayout xmlns:android="http://schemas.android.com/apk/res/android" xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent" android:layout_height="match_parent">
    <com.tencent.rtmp.ui.TXCloudVideoView android:id="@+id/video" android:layout_width="match_parent" android:layout_height="match_parent"/>
    <androidx.constraintlayout.widget.Guideline android:id="@+id/half" android:layout_width="wrap_content" android:layout_height="wrap_content" android:orientation="vertical" app:layout_constraintGuide_percent="0.5"/>
    <ImageView android:id="@+id/close" android:layout_width="36dp" android:layout_height="36dp" android:src="@drawable/ic_close" app:tint="#FFFFFF"
      app:layout_constraintEnd_toEndOf="parent" app:layout_constraintTop_toTopOf="parent" android:layout_marginEnd="8dp"/>
    <com.demo.ControlBar android:id="@+id/bar" android:layout_width="0dp" android:layout_height="wrap_content"
      app:layout_constraintStart_toStartOf="parent" app:layout_constraintEnd_toEndOf="parent" app:layout_constraintBottom_toBottomOf="parent"/>
  </androidx.constraintlayout.widget.ConstraintLayout>`,
  [`${RES}/layout/view_control_bar.xml`]: `<merge xmlns:android="http://schemas.android.com/apk/res/android">
    <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="Live"/>
  </merge>`,
  [`${JAVA}/HomeActivity.java`]: 'public class HomeActivity extends AppCompatActivity { protected void onCreate(Bundle b) { super.onCreate(b); setContentView(R.layout.activity_home); } }',
  [`${JAVA}/PlayerActivity.kt`]: 'class PlayerActivity : AppCompatActivity() { override fun onCreate(b: Bundle?) { super.onCreate(b); binding = ActivityPlayerBinding.inflate(layoutInflater); dialog.setContentView(R.layout.view_control_bar) } }',
  [`${JAVA}/ControlBar.java`]: 'public class ControlBar extends LinearLayout { public ControlBar(Context c) { super(c); setOrientation(LinearLayout.VERTICAL); LayoutInflater.from(c).inflate(R.layout.view_control_bar, this, true); } }',
};

async function draw(component: string, file: string): Promise<ScreenPreview> {
  const source = { readText: async (p: string) => files[p] ?? null, exists: async (p: string) => p in files };
  const previewer = await AndroidPreviewer.open(source, Object.keys(files));
  return previewer.preview({ screenId: `android:${component}`, file, component });
}

const all = (n: PreviewNode): PreviewNode[] => [n, ...(n.children ?? []).flatMap(all)];
const text = (n: PreviewNode): string => (n.type === 'raw' ? n.text! : (n.children ?? []).map(text).join(''));

describe('Android preview — layouts and resources', () => {
  it('draws a LinearLayout with styles, string and dimension resources, weights, includes and drawables', async () => {
    const p = await draw('HomeActivity', `${JAVA}/HomeActivity.java`);
    expect(p).toMatchObject({ platform: 'android', width: 360, notes: [] });
    // Light AppCompat theme without an action bar: window background below the status bar.
    expect(p.root.style).toMatchObject({ backgroundColor: '#FAFAFA', paddingTop: 24 });
    const root = all(p.root).find((n) => n.component === 'LinearLayout')!;
    expect(root.style).toMatchObject({ flexDirection: 'column', alignItems: 'center', paddingTop: 12, paddingLeft: 12, justifySelf: 'stretch', alignSelf: 'stretch' });
    const [logo, title, subtitle, footer] = root.children!;
    expect(logo!.image).toEqual({ assetPath: `${RES}/drawable-xxhdpi/logo.png`, resizeMode: 'contain', density: 3 });
    expect(title!.style).toMatchObject({ fontSize: 20, fontWeight: 'bold', color: 'rgba(0,0,0,0.87)' });
    expect(text(title!)).toBe('Demo');
    // tools:text is the designer's sample; a weighted 0dp height grows.
    expect(text(subtitle!)).toBe('Sample subtitle');
    expect(subtitle!.style).toMatchObject({ alignSelf: 'stretch', flexGrow: 1, flexBasis: 0 });
    // The gone TextView is not drawn; the included Button keeps the include's margin and its shape background.
    expect(root.children).toHaveLength(4);
    expect(footer!.style).toMatchObject({ marginTop: 8, height: 48, backgroundColor: '#8E33FF', borderRadius: 24, borderWidth: 1, borderStyle: 'dashed', textTransform: 'uppercase' });
    expect(text(footer!)).toBe('スタート');
  });

  it('describes ConstraintLayout children as constraints and opens custom views to the layout they inflate', async () => {
    const p = await draw('PlayerActivity', `${JAVA}/PlayerActivity.kt`);
    // Dark AppCompat theme from the activity's own theme; the layout comes from view binding.
    expect(p.root.style).toMatchObject({ backgroundColor: '#303030' });
    const box = all(p.root).find((n) => n.layout === 'constraints')!;
    expect(box.wrapHeight).toBe(false);
    const byId = Object.fromEntries(box.children!.map((c) => [c.constraint?.id, c]));
    expect(byId.video).toMatchObject({ style: { backgroundColor: '#000000' }, constraint: { width: 'parent', height: 'parent' } });
    expect(byId.half!.constraint!.guide).toEqual({ orientation: 'vertical', percent: 0.5, begin: undefined, end: undefined });
    expect(byId.close!.constraint).toMatchObject({ width: 36, height: 36, right: { to: 'parent', edge: 'right' }, top: { to: 'parent', edge: 'top' } });
    expect(byId.close!.style).toMatchObject({ marginRight: 8 });
    // The vector icon becomes SVG, tinted.
    const svg = all(byId.close!).find((n) => n.svg?.tag === 'path')!;
    expect(svg.svg!.attrs).toMatchObject({ d: 'M6,6L18,18', fill: '#FFFFFF' });
    expect(byId.bar).toMatchObject({ component: 'ControlBar', style: { flexDirection: 'column' }, constraint: { width: 'match', left: { to: 'parent', edge: 'left' }, bottom: { to: 'parent', edge: 'bottom' } } });
    expect(text(byId.bar!)).toBe('Live');
  });

  it('reads Android colors with alpha', () => {
    expect(androidHex('#80000000')).toBe('rgba(0,0,0,0.502)');
    expect(androidHex('#FFF')).toBe('#FFFFFF');
    expect(androidHex('#FF8E33FF')).toBe('#8E33FF');
  });

  it('says when a screen has no layout', async () => {
    files[`${JAVA}/Empty.java`] = 'public class Empty extends Activity {}';
    const p = await draw('Empty', `${JAVA}/Empty.java`);
    expect(p.notes).toEqual(['No layout was found for Empty (setContentView, inflate or view binding).']);
  });
});
