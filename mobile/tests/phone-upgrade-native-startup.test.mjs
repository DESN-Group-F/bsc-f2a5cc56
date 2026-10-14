import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot=fileURLToPath(new URL('../',import.meta.url));
const nativePath=path.join(mobileRoot,'android/app/src/main/java/com/batteryinventory/mobile');
const javaDirectory=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin'):process.platform==='win32'?'C:/Program Files/Common Files/Oracle/Java/javapath':'';
const executable=name=>javaDirectory?path.join(javaDirectory,`${name}${process.platform==='win32'?'.exe':''}`):name;

test('MainActivity adds only startup registration before super and retains every accepted dispatch/back byte',async()=>{
  const source=await readFile(path.join(nativePath,'MainActivity.java'),'utf8');
  const registration='        PhoneStartupBridge startup = PhoneStartupBridge.install(this, getLifecycle());\n        bridgeBuilder.addWebViewListener(startup);\n';
  assert.equal(source.split(registration).length,2);
  const baseline=source.replace(registration,'');
  assert.equal(createHash('sha256').update(baseline).digest('hex'),'ce9614de2b5872d154e158c3b6070d2265903e8a85d2c07c9fc7e393d197a69d');
  assert.ok(source.indexOf(registration)<source.indexOf('super.onCreate(savedInstanceState)'));
});

const sources={
  'android/app/Activity.java':'package android.app; public class Activity {}',
  'android/os/Looper.java':'package android.os; public class Looper { public static Looper getMainLooper(){return new Looper();} }',
  'android/os/Handler.java':`package android.os; import java.util.*; public class Handler {
    public static final List<Runnable> delayed=new ArrayList<>(); public static long lastDelay;public static int posted;
    public Handler(Looper ignored){} public boolean postDelayed(Runnable work,long delay){posted++;lastDelay=delay;delayed.add(work);return true;}
    public void removeCallbacks(Runnable work){delayed.remove(work);} public static void expire(){for(Runnable work:new ArrayList<>(delayed))work.run();}
  }`,
  'android/webkit/RenderProcessGoneDetail.java':'package android.webkit; public class RenderProcessGoneDetail {}',
  'android/webkit/WebView.java':`package android.webkit; import java.util.*; public class WebView {
    public abstract static class VisualStateCallback { public abstract void onComplete(long requestId); }
    public final List<VisualStateCallback> callbacks=new ArrayList<>(); public String url="https://localhost/";public boolean fail;
    public String getUrl(){return url;} public void postVisualStateCallback(long requestId,VisualStateCallback callback){if(fail)throw new IllegalStateException("Controlled unavailable renderer");callbacks.add(callback);}
    public void drawReady(){for(VisualStateCallback callback:new ArrayList<>(callbacks))callback.onComplete(0);}
  }`,
  'androidx/lifecycle/LifecycleOwner.java':'package androidx.lifecycle; public interface LifecycleOwner { Lifecycle getLifecycle(); }',
  'androidx/lifecycle/DefaultLifecycleObserver.java':'package androidx.lifecycle; public interface DefaultLifecycleObserver { default void onDestroy(LifecycleOwner owner){} }',
  'androidx/lifecycle/Lifecycle.java':`package androidx.lifecycle; import java.util.*; public class Lifecycle {
    public final List<DefaultLifecycleObserver> observers=new ArrayList<>();public void addObserver(DefaultLifecycleObserver observer){observers.add(observer);}public void removeObserver(DefaultLifecycleObserver observer){observers.remove(observer);}
    public void destroy(){for(DefaultLifecycleObserver observer:new ArrayList<>(observers))observer.onDestroy(()->this);}
  }`,
  'androidx/core/splashscreen/SplashScreen.java':`package androidx.core.splashscreen; public class SplashScreen {
    public interface KeepOnScreenCondition { boolean shouldKeepOnScreen(); } public interface OnExitAnimationListener { void onSplashScreenExit(SplashScreenViewProvider provider); }
    public static SplashScreen last;public KeepOnScreenCondition condition;public OnExitAnimationListener exitListener;
    public static SplashScreen installSplashScreen(android.app.Activity activity){last=new SplashScreen();return last;}
    public void setKeepOnScreenCondition(KeepOnScreenCondition value){condition=value;}
    public void setOnExitAnimationListener(OnExitAnimationListener value){exitListener=value;}
    public SplashScreenViewProvider dispatchExit(){if(condition.shouldKeepOnScreen())return null;SplashScreenViewProvider provider=new SplashScreenViewProvider();if(exitListener!=null)exitListener.onSplashScreenExit(provider);return provider;}
  }`,
  'androidx/core/splashscreen/SplashScreenViewProvider.java':'package androidx.core.splashscreen; public class SplashScreenViewProvider { public int removeCalls; public void remove(){removeCalls++;} }',
  'com/getcapacitor/WebViewListener.java':`package com.getcapacitor; import android.webkit.*; public abstract class WebViewListener {
    public void onPageCommitVisible(WebView view,String url){}public void onPageLoaded(WebView view){}public boolean onRenderProcessGone(WebView view,RenderProcessGoneDetail detail){return false;}
  }`,
  'com/batteryinventory/mobile/StartupHarness.java':`package com.batteryinventory.mobile;
import android.os.Handler;import android.webkit.WebView;import androidx.lifecycle.Lifecycle;import androidx.core.splashscreen.SplashScreen;import androidx.core.splashscreen.SplashScreenViewProvider;
public class StartupHarness {
 static int checks;static void check(boolean value,String message){checks++;if(!value)throw new AssertionError(message);}
 static PhoneStartupBridge install(Lifecycle lifecycle){check(Handler.delayed.isEmpty(),"Previous helper retains no deadline");return PhoneStartupBridge.install(new android.app.Activity(),lifecycle);}
 static boolean held(){return SplashScreen.last.condition.shouldKeepOnScreen();}
 public static void main(String[] args){
  Lifecycle lifecycle=new Lifecycle();PhoneStartupBridge startup=install(lifecycle);WebView view=new WebView();
  check(held(),"Platform starting window initially protects the uncommitted document");check(Handler.lastDelay>0&&Handler.lastDelay<=5000&&Handler.delayed.size()==1,"Only one bounded failure ceiling is scheduled");
  check(SplashScreen.last.exitListener!=null&&SplashScreen.last.dispatchExit()==null,"Direct exit is registered but the platform visual-ready gate still prevents early removal");
  startup.onPageCommitVisible(view,"about:blank");check(view.callbacks.isEmpty()&&held(),"An empty WebView cannot release the initial frame");
  startup.onPageCommitVisible(view,"https://localhost/");check(held()&&view.callbacks.size()==1,"Local commit still awaits a drawable visual state");
  startup.onPageLoaded(view);check(view.callbacks.size()==1,"Loaded and committed events do not duplicate the visual barrier");
  check(SplashScreen.last.dispatchExit()==null,"Local commit alone cannot trigger the direct exit before the visual callback");
  view.drawReady();check(!held(),"Drawable local content releases immediately without session or network completion");check(Handler.delayed.isEmpty()&&lifecycle.observers.isEmpty(),"Success removes deadline and observer");
  int scheduled=Handler.posted;SplashScreenViewProvider provider=SplashScreen.last.dispatchExit();check(provider!=null&&provider.removeCalls==1,"The ready-frame exit removes the platform splash synchronously without icon fade or reveal");check(Handler.posted==scheduled&&Handler.delayed.isEmpty(),"Direct removal adds no pause or delayed work after visual readiness");
  startup.onPageCommitVisible(view,"https://localhost/next");check(view.callbacks.size()==1&&!held(),"Later navigation cannot replay startup");
  Lifecycle fallbackLife=new Lifecycle();PhoneStartupBridge fallback=install(fallbackLife);WebView fallbackView=new WebView();fallback.onPageLoaded(fallbackView);check(fallbackView.callbacks.size()==1&&held(),"Page-loaded fallback uses the same visual barrier");fallbackView.drawReady();check(!held(),"Fallback releases as soon as a frame is ready");
  Lifecycle failedLife=new Lifecycle();PhoneStartupBridge failed=install(failedLife);check(held(),"Missing WebView keeps only the initial window");Handler.expire();check(!held()&&Handler.delayed.isEmpty()&&failedLife.observers.isEmpty(),"Failure ceiling releases without waiting indefinitely");check(SplashScreen.last.dispatchExit().removeCalls==1,"The bounded failure exit also removes its owned splash immediately");
  Lifecycle goneLife=new Lifecycle();PhoneStartupBridge gone=install(goneLife);check(!gone.onRenderProcessGone(new WebView(),new android.webkit.RenderProcessGoneDetail()),"Existing renderer failure handling remains authoritative");check(!held()&&Handler.delayed.isEmpty(),"Renderer failure releases the starting window");
  Lifecycle destroyLife=new Lifecycle();PhoneStartupBridge destroyed=install(destroyLife);WebView late=new WebView();destroyed.onPageCommitVisible(late,"https://localhost/");destroyLife.destroy();check(!held()&&Handler.delayed.isEmpty()&&destroyLife.observers.isEmpty(),"Activity destruction releases and cleans up");late.drawReady();check(!held(),"Late visual callback cannot reopen a destroyed starting window");
  Lifecycle errorLife=new Lifecycle();PhoneStartupBridge error=install(errorLife);WebView unavailable=new WebView();unavailable.fail=true;error.onPageCommitVisible(unavailable,"https://localhost/");check(!held()&&Handler.delayed.isEmpty(),"Visual callback rejection has a bounded usable error exit");
  System.out.println("Passed "+checks+" actual-Java startup handoff assertions; controlled SDK callbacks, not native frame timing.");
 }
}`,
};

test('production startup helper releases only for a drawable local frame or bounded failure and cleans up destruction',{timeout:30000},async context=>{
  if(javaDirectory&&!existsSync(executable('javac')))return context.skip('JDK unavailable; startup helper compilation was not executed.');
  const version=spawnSync(executable('javac'),['-version'],{encoding:'utf8',windowsHide:true});if(version.error)return context.skip('JDK unavailable; startup helper compilation was not executed.');
  const base=path.resolve(mobileRoot,'..','work');await mkdir(base,{recursive:true});const work=await mkdtemp(path.join(base,'mobile-native-startup-')),files=[];
  for(const[relative,source]of Object.entries(sources)){const target=path.join(work,relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,source);files.push(target);}
  files.push(path.join(nativePath,'PhoneStartupBridge.java'));
  const compiled=spawnSync(executable('javac'),['-d',work,...files],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(compiled.status,0,compiled.stderr||compiled.error?.message);
  const run=spawnSync(executable('java'),['-cp',work,'com.batteryinventory.mobile.StartupHarness'],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(run.status,0,run.stderr||run.error?.message);assert.match(run.stdout,/Passed \d+ actual-Java startup handoff assertions/);context.diagnostic(run.stdout.trim());
});
