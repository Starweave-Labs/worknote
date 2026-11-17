/**
 * 图片灯箱(Headless UI Dialog)。
 *
 * 用 Dialog 拿到:焦点陷阱、Esc 关闭、点击遮罩关闭、aria 语义与滚动锁定,
 * 这些在旧版是手写 JS 做的。
 */
import { Dialog, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { Fragment, useEffect, useState } from "react";

export interface LightboxImage {
  url: string;
  alt: string;
  thumbUrl?: string;
}

interface Props {
  image: LightboxImage | null;
  onClose: () => void;
}

export function Lightbox({ image, onClose }: Props) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
  }, [image?.url]);

  return (
    <Transition show={!!image} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-[1000]">
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-[rgba(12,15,19,0.88)]" aria-hidden="true" />
        </TransitionChild>

        <div className="fixed inset-0 flex items-center justify-center p-4">
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0 scale-[0.97]"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-[0.97]"
          >
            <DialogPanel className="relative flex max-h-[90vh] max-w-[92vw] flex-col items-center">
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭"
                className="absolute -top-10 right-0 cursor-pointer border-none bg-transparent p-1 text-white/70 transition hover:text-white"
              >
                <XMarkIcon className="h-7 w-7" />
              </button>
              {image && (
                <>
                  <div className="relative flex max-h-[82vh] max-w-full items-center justify-center overflow-hidden rounded-md bg-black/40">
                    {/* 低清底图占位(若有且高清图尚未就绪) */}
                    {image.thumbUrl && !loaded && (
                      <img
                        src={image.thumbUrl}
                        alt=""
                        aria-hidden="true"
                        className="max-h-[82vh] max-w-full scale-105 rounded-md object-contain blur-sm"
                      />
                    )}
                    {/* 高清原图 */}
                    <img
                      src={image.url}
                      alt={image.alt}
                      onLoad={() => setLoaded(true)}
                      className={`max-h-[82vh] max-w-full rounded-md object-contain shadow-2xl transition-opacity duration-300 ${
                        loaded ? "opacity-100" : image.thumbUrl ? "opacity-0 absolute inset-0 m-auto" : "opacity-100"
                      }`}
                    />
                  </div>
                  {image.alt && (
                    <p className="mt-3 max-w-[80vw] text-center text-[13px] text-[#cfd6de]">
                      {image.alt}
                    </p>
                  )}
                </>
              )}
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}