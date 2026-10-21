import type { PreviewNode } from '@appflow/model';
import { describe, expect, it } from 'vitest';
import { IosPreviewer } from './ios';

const XIB = `<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.XIB" version="3.0">
  <objects>
    <placeholder placeholderIdentifier="IBFilesOwner" id="-1" customClass="TermsViewController">
      <connections><outlet property="view" destination="root" id="o1"/></connections>
    </placeholder>
    <view contentMode="scaleToFill" id="root">
      <rect key="frame" x="0.0" y="0.0" width="393" height="852"/>
      <subviews>
        <label text="Terms" textAlignment="center" translatesAutoresizingMaskIntoConstraints="NO" id="title">
          <rect key="frame" x="146.5" y="60" width="100" height="28"/>
          <fontDescription key="fontDescription" type="system" weight="medium" pointSize="18"/>
          <color key="textColor" name="Purple06"/>
          <userDefinedRuntimeAttributes><userDefinedRuntimeAttribute type="string" keyPath="fontName" value="NotoSansJP-Medium"/></userDefinedRuntimeAttributes>
        </label>
        <imageView image="ic_back" contentMode="scaleAspectFit" id="back">
          <rect key="frame" x="16" y="62" width="24" height="24"/>
        </imageView>
        <label text="Hidden" hidden="YES" id="gone"><rect key="frame" x="0" y="0" width="10" height="10"/></label>
        <button buttonType="system" id="submit">
          <rect key="frame" x="16" y="736" width="361" height="40"/>
          <color key="backgroundColor" red="0.5" green="0.0" blue="1" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
          <fontDescription key="fontDescription" type="boldSystem" pointSize="14"/>
          <state key="normal" title="Agree"><color key="titleColor" white="1" alpha="1" colorSpace="custom" customColorSpace="genericGamma22GrayColorSpace"/></state>
          <userDefinedRuntimeAttributes><userDefinedRuntimeAttribute type="number" keyPath="cornerRadius"><real key="value" value="8"/></userDefinedRuntimeAttribute></userDefinedRuntimeAttributes>
        </button>
        <textField placeholder="Code" borderStyle="roundedRect" id="field"><rect key="frame" x="16" y="200" width="361" height="34"/></textField>
      </subviews>
      <color key="backgroundColor" systemColor="systemBackgroundColor"/>
    </view>
  </objects>
  <resources>
    <image name="ic_back" width="24" height="24"/>
    <namedColor name="Purple06"><color red="0.55" green="0.2" blue="1" alpha="1" colorSpace="custom" customColorSpace="sRGB"/></namedColor>
    <systemColor name="systemBackgroundColor"><color white="1" alpha="1" colorSpace="custom" customColorSpace="genericGamma22GrayColorSpace"/></systemColor>
  </resources>
</document>`;

const files: Record<string, string> = {
  'ios/App/TermsViewController.swift': 'final class TermsViewController: UIViewController { init() { super.init(nibName: "TermsViewController", bundle: nil) } }',
  'ios/App/Resources/TermsViewController.xib': XIB,
  'ios/App/Assets.xcassets/ic_back.imageset/Contents.json': JSON.stringify({ images: [{ filename: 'back.png', scale: '1x' }, { filename: 'back@3x.png', scale: '3x' }] }),
  'ios/App/Fonts/NotoSansJP-Medium.ttf': '',
  'ios/App/CodeViewController.swift': 'final class CodeViewController: UIViewController { override func viewDidLoad() { let v = UINib(nibName: "TermsViewController", bundle: nil) } }',
  'ios/App/Main.storyboard': `<document><scenes><scene sceneID="s1"><objects><viewController id="vc1" customClass="HomeViewController">
    <view key="view" id="v1"><rect key="frame" x="0" y="0" width="375" height="667"/><subviews>
      <switch on="YES" id="sw"><rect key="frame" x="20" y="100" width="51" height="31"/></switch>
    </subviews><color key="backgroundColor" white="0.0" alpha="1"/></view>
  </viewController></objects></scene></scenes></document>`,
};

const previewer = () => IosPreviewer.open({ readText: async (p) => files[p] ?? null, exists: async (p) => p in files }, Object.keys(files));
const all = (n: PreviewNode): PreviewNode[] => [n, ...(n.children ?? []).flatMap(all)];

describe('iOS preview — XIB and storyboard screens', () => {
  it('draws a view controller XIB at its frames, with named and system colors, fonts and asset images', async () => {
    const p = (await previewer().preview({ screenId: 'ios:TermsViewController', file: 'ios/App/TermsViewController.swift', component: 'TermsViewController' }))!;
    expect(p).toMatchObject({ platform: 'ios', width: 393, height: 852, fonts: [{ family: 'NotoSansJP-Medium', path: 'ios/App/Fonts/NotoSansJP-Medium.ttf' }] });
    expect(p.root.style).toMatchObject({ backgroundColor: 'rgba(255,255,255,1)', width: 393 });
    const [title, back, submit, field] = p.root.children!;
    expect(p.root.children).toHaveLength(4);
    // A centered one-line Auto Layout label grows with its text around its center.
    expect(title!.style).toMatchObject({ position: 'absolute', top: 60, minWidth: 100, left: 196.5, color: 'rgba(140,51,255,1)', fontSize: 18, fontWeight: '500', fontFamily: 'NotoSansJP-Medium', textAlign: 'center' });
    expect(back!.image).toEqual({ assetPath: 'ios/App/Assets.xcassets/ic_back.imageset/back@3x.png', resizeMode: 'contain', density: 3 });
    expect(submit!.style).toMatchObject({ left: 16, top: 736, width: 361, height: 40, backgroundColor: 'rgba(128,0,255,1)', borderRadius: 8 });
    expect(all(submit!).find((n) => n.type === 'raw')!.text).toBe('Agree');
    expect(all(submit!).find((n) => n.type === 'text')!.style).toMatchObject({ color: 'rgba(255,255,255,1)', fontWeight: '700', fontSize: 14 });
    expect(field).toMatchObject({ type: 'input', placeholder: 'Code', style: { borderRadius: 5 } });
  });

  it('draws a storyboard scene and leaves view controllers built in code alone', async () => {
    const scene = (await previewer().preview({ screenId: 'ios:sb:Main.storyboard#vc1', file: 'ios/App/Main.storyboard', component: 'HomeViewController' }))!;
    expect(scene).toMatchObject({ width: 375, height: 667, root: { style: { backgroundColor: 'rgba(0,0,0,1)' } } });
    expect(scene.root.children![0]).toMatchObject({ type: 'switch', checked: true, style: { left: 20, top: 100 } });
    // UINib(nibName:) loads a subview, not the screen.
    expect(await previewer().preview({ screenId: 'ios:CodeViewController', file: 'ios/App/CodeViewController.swift', component: 'CodeViewController' })).toBeNull();
  });
});
