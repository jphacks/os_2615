import React, {useLayoutEffect, useRef} from 'react';
/* PC・スマホとも2行から伸縮し、長文では入力欄内をスクロールする。 */
export default function ReplyTextarea(props) {
 const ref=useRef(null);
 useLayoutEffect(()=>{
  const element=ref.current;
  const resize=()=>{
   const style=getComputedStyle(element);
   const min=Number.parseFloat(style.lineHeight)*2+Number.parseFloat(style.paddingTop)+Number.parseFloat(style.paddingBottom);
   element.style.height='0px';
   element.style.height=`${Math.min(150, Math.max(min, element.scrollHeight))}px`;
  };
  resize();
  const observer=new ResizeObserver(resize);
  observer.observe(element.parentElement);
  window.addEventListener('resize',resize);
  return()=>{observer.disconnect();window.removeEventListener('resize',resize);};
 },[props.value]);
 return <textarea {...props} ref={ref}/>;
}
