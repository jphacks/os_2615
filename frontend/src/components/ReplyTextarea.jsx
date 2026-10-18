import React, {useCallback, useLayoutEffect, useRef} from 'react';
/* 入力ごとに監視を作り直さず、2行からの自動伸縮を維持する。 */
export default function ReplyTextarea(props) {
 const ref=useRef(null), composing=useRef(false), compositionEnded=useRef(0);
 const resize=useCallback(()=>{
  const element=ref.current;if(!element)return;
  const style=getComputedStyle(element);
  const min=Number.parseFloat(style.lineHeight)*2+Number.parseFloat(style.paddingTop)+Number.parseFloat(style.paddingBottom);
  element.style.height='0px';
  element.style.height=`${Math.min(150,Math.max(min,element.scrollHeight))}px`;
 },[]);
 useLayoutEffect(resize,[props.value,resize]);
 useLayoutEffect(()=>{
  const observer=new ResizeObserver(resize);
  observer.observe(ref.current.parentElement);
  window.addEventListener('resize',resize);
  return()=>{observer.disconnect();window.removeEventListener('resize',resize);};
 },[resize]);
 const {onSend,...textareaProps}=props;
 return <textarea {...textareaProps} ref={ref}
  onCompositionStart={()=>{composing.current=true;}}
  onCompositionEnd={()=>{composing.current=false;compositionEnded.current=Date.now();}}
  onKeyDown={event=>{
   if((event.metaKey||event.ctrlKey)&&!event.altKey&&event.key.toLowerCase()==='a'){
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.select();
    return;
   }
   if(event.key!=='Enter'||event.shiftKey||event.ctrlKey||event.altKey||event.metaKey)return;
   if(composing.current||event.nativeEvent.isComposing||event.nativeEvent.keyCode===229||Date.now()-compositionEnded.current<100)return;
   event.preventDefault();
   if(!event.repeat)onSend?.(event);
  }}/>;
}
