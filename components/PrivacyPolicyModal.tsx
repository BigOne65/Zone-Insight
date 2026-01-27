import React from 'react';

interface PrivacyPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PrivacyPolicyModal: React.FC<PrivacyPolicyModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col animate-fade-in">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
          <h2 className="text-lg font-bold text-gray-800">개인정보처리방침 및 이용약관</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl font-light">&times;</button>
        </div>
        <div className="p-6 overflow-y-auto custom-scrollbar text-sm text-gray-600 space-y-4">
          <section>
            <h3 className="text-base font-bold text-gray-800 mb-2">1. 개인정보의 처리 목적</h3>
            <p>본 서비스('상권분석 앱')는 별도의 회원가입 없이 이용 가능하며, 사용자의 개인정보를 서버에 저장하지 않습니다. 단, 서비스 제공을 위해 아래와 같은 정보를 일시적으로 처리할 수 있습니다.</p>
          </section>
          
          <section>
            <h3 className="text-base font-bold text-gray-800 mb-2">2. 쿠키(Cookie) 및 광고 게재</h3>
            <p>본 사이트는 사용자에게 더 나은 서비스를 제공하고 맞춤형 광고를 송출하기 위해 Google AdSense 및 제휴사의 쿠키를 사용합니다.</p>
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>Google을 포함한 타사 공급업체는 쿠키를 사용하여 사용자의 과거 웹사이트 방문 기록을 기반으로 광고를 게재합니다.</li>
              <li>Google의 광고 쿠키 사용으로 인해 Google 및 파트너는 사용자의 본 사이트 또는 인터넷의 다른 사이트 방문 기록을 기반으로 적절한 광고를 게재할 수 있습니다.</li>
              <li>사용자는 <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">광고 설정</a>을 방문하여 맞춤광고를 사용 중지할 수 있습니다.</li>
            </ul>
          </section>

          <section>
            <h3 className="text-base font-bold text-gray-800 mb-2">3. 외부 데이터 활용</h3>
            <p>본 서비스는 공공데이터포털(Data.go.kr) 및 V-World API를 활용하여 데이터를 시각화하는 도구입니다. 제공되는 데이터의 정확성이나 최신성에 대해 법적 책임을 지지 않습니다.</p>
          </section>

          <section>
            <h3 className="text-base font-bold text-gray-800 mb-2">4. 위치 정보</h3>
            <p>사용자가 입력한 주소 또는 위치 정보는 API 호출을 위해서만 사용되며, 별도로 수집되거나 저장되지 않습니다.</p>
          </section>
        </div>
        <div className="p-4 border-t flex justify-end bg-gray-50 rounded-b-xl">
          <button onClick={onClose} className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 font-medium transition-colors">확인</button>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicyModal;