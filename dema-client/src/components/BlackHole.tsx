// The "Black hole" theme's sky: a live shader, drawn at the screen's own resolution so it stays sharp at any size. It paints a black
// shadow, a tilted accretion disk turning faster near the centre (bright on the side coming towards you), light from the far side of
// the disk bent over and under the hole, and stars pulled out of place around it. No image or video is downloaded. Loaded only when
// the theme is chosen; the page falls back to a plain CSS glow if WebGL is not available. If the browser drops the graphics context it is rebuilt on a fresh canvas.
import { useEffect, useRef, useState } from "react";

const VERT = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";
const FRAG = `precision highp float;
uniform vec2 uRes;uniform vec2 uC;uniform float uT;
const float R=0.15;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*noise(p);p=p*2.03+17.;a*=.5;}return s;}
vec3 ramp(float t){vec3 c=mix(vec3(.16,.015,0.),vec3(1.,.34,.05),smoothstep(0.,.55,t));return mix(c,vec3(1.,.93,.74),smoothstep(.55,1.,t));}
vec3 stars(vec2 p){vec3 c=vec3(0.);for(int l=0;l<3;l++){float sc=34.+float(l)*52.;vec2 g=p*sc;vec2 id=floor(g);vec2 f=fract(g)-.5;float h=hash(id+float(l)*7.1);
 if(h>.94){vec2 o=vec2(hash(id+3.3),hash(id+9.1))-.5;float d=length(f-o*.6);float b=smoothstep(.1,0.,d)*(h-.94)*15.;b*=.75+.25*sin(uT*(.8+h*3.)+h*60.);c+=b*mix(vec3(.7,.8,1.),vec3(1.,.9,.75),hash(id+1.7));}}return c;}
vec3 disk(float r,float phi,float rin,float rout){
 float t=clamp((rout-r)/(rout-rin),0.,1.);
 float w=pow(max(r,rin)/rin,-1.5);
 float a=phi-uT*.55*w;
 vec2 ca=vec2(cos(a),sin(a));   /* the angle goes round a circle in noise space, so there is no seam where it wraps */
 float n=fbm(vec2(r*22.,0.)+ca*2.6)*.9+fbm(vec2(r*60.,3.)+ca*6.)*.35;
 float inten=pow(t,1.5)*(.3+1.25*n);
 float dop=1.-.6*cos(phi);   /* the left side turns towards us */
 return ramp(t*.9+.1*n)*inten*dop*dop*2.1;}
void main(){
 vec2 p=(gl_FragCoord.xy-uC*uRes)/uRes.y;
 float d=length(p);
 vec2 q=p-(R*R*1.7)*p/max(dot(p,p),R*R*.55);          /* light is pulled around the hole */
 float s=uT*.004;mat2 m=mat2(cos(s),-sin(s),sin(s),cos(s));
 vec3 col=stars(m*q+3.)+vec3(.05,.02,.1)*fbm(m*q*1.6+4.)*.5;
 float rin=R*1.5,rout=R*5.4,tilt=.19;
 float ang=atan(p.y,p.x);
 /* the far side of the disk, bent over the top and under the bottom of the shadow */
 float ring=exp(-pow((d-R*1.13)/(R*.2),2.))+.35*exp(-pow((d-R*1.45)/(R*.55),2.));
 float arc=.5+.5*smoothstep(-.4,.7,p.y/max(d,1e-4));
 float rr=rin+(d-R)*1.9;
 col+=ring*arc*disk(rr,ang+1.5708,rin,rout)*1.6;
 col+=vec3(1.,.86,.62)*exp(-pow((d-R*1.035)/(R*.03),2.))*(.6+.5*arc)*step(R,d); /* the thin photon ring */
 col+=ramp(.55)*.09*exp(-(d-R)*5./R)*step(R,d);       /* bloom */
 col*=smoothstep(R*.96,R*1.02,d);                     /* the shadow hides everything behind it */
 /* the disk itself, tilted: the near half passes in front of the shadow, the far half behind it */
 vec2 dp=vec2(p.x,p.y/tilt);float r=length(dp);
 if(r>rin&&r<rout){
  float e=smoothstep(rin,rin*1.06,r)*smoothstep(rout,rout*.8,r);
  vec3 dc=disk(r,atan(dp.y,dp.x),rin,rout)*e;
  float front=step(p.y,0.);
  float vis=front+(1.-front)*smoothstep(R*.98,R*1.04,d);
  float cover=vis*clamp(dot(dc,vec3(.6))*1.4,0.,1.); /* the same on both sides of the horizon line: no seam */
  col=col*(1.-cover)+dc*vis;}
 col=1.-exp(-col*1.35);col=pow(col,vec3(.92));
 col*=1.-.4*smoothstep(.6,1.6,length(gl_FragCoord.xy/uRes-uC)*1.4);
 gl_FragColor=vec4(col,1.);}`;

export default function BlackHole({ calm }: Readonly<{ calm: boolean }>) {
  const ref = useRef<HTMLCanvasElement>(null);
  const calmRef = useRef(calm);
  calmRef.current = calm;
  const [epoch, setEpoch] = useState(0); // a lost graphics context (a busy GPU) gets a fresh canvas, so the sky never freezes
  useEffect(() => {
    const cv = ref.current;
    const gl = cv?.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!cv || !gl) return;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return; // the CSS glow stays
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, "uRes");
    const uC = gl.getUniformLocation(prog, "uC");
    const uT = gl.getUniformLocation(prog, "uT");
    const calmMotion = matchMedia("(prefers-reduced-motion: reduce)").matches; // a gentle drift, a quarter of the speed, never a frozen picture
    const t0 = performance.now();
    let raf = 0;
    let last = 0;
    let lost = false;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || lost || now - last < (calmRef.current ? 83 : 33)) return; // 30 frames a second, 12 during a call
      last = now;
      // Sharp, but with a pixel budget so a 4K screen does not pay four times for a slow glow.
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      const scale = Math.min(window.devicePixelRatio || 1, Math.sqrt(2.1e6 / Math.max(1, w * h)));
      const pw = Math.max(1, Math.round(w * scale));
      const ph = Math.max(1, Math.round(h * scale));
      if (cv.width !== pw || cv.height !== ph) {
        cv.width = pw;
        cv.height = ph;
      }
      gl.viewport(0, 0, pw, ph);
      gl.uniform2f(uRes, pw, ph);
      gl.uniform2f(uC, w > 860 ? 0.72 : 0.5, w > 860 ? 0.54 : 0.76); // the hole sits off to the side (high, on a phone); y is up
      gl.uniform1f(uT, ((now - t0) / 1000) * (calmMotion ? 0.25 : 1));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(draw);
    const onLost = (e: Event) => {
      e.preventDefault();
      lost = true;
      if (epoch < 6) setTimeout(() => setEpoch((n) => n + 1), 400);
    };
    cv.addEventListener("webglcontextlost", onLost);
    const onResize = () => {
      last = 0;
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      cv.removeEventListener("webglcontextlost", onLost);
      window.removeEventListener("resize", onResize);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [epoch]);
  return <canvas key={epoch} ref={ref} className="bh-canvas" aria-hidden="true" />;
}
